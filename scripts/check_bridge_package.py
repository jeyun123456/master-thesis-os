"""Offline completeness and provenance checks for the packaged Local Bridge."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath


PROVENANCE_NAME = "bridge-provenance.json"
FORMAT_VERSION = 1
_GIT_SHA = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class PackageCheckError(ValueError):
    pass


def _read_list(path: Path, pattern: str, value_pattern: str, label: str) -> list[str]:
    source = path.read_text(encoding="utf-8-sig")
    match = re.search(pattern, source, re.DOTALL)
    if match is None:
        raise PackageCheckError(f"Could not find {label} in {path.name}.")
    values = re.findall(value_pattern, match.group(1), re.MULTILINE)
    if not values:
        raise PackageCheckError(f"{label} is empty in {path.name}.")
    return values


def _safe_package_path(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or path.as_posix() != value
        or path.is_absolute()
        or len(path.parts) != 1
        or any(part in {"", ".", ".."} for part in path.parts)
        or ":" in value
    ):
        raise PackageCheckError(f"Unsafe Bridge package path: {value!r}.")
    return path.as_posix()


def _unique_paths(values: list[str], label: str) -> set[str]:
    paths = [_safe_package_path(value) for value in values]
    if len(paths) != len(set(paths)):
        raise PackageCheckError(f"Duplicate paths in {label}.")
    return set(paths)


def _module_imports(path: Path, source_root: Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    except (OSError, SyntaxError) as exc:
        raise PackageCheckError(f"Could not parse {path.name}: {exc}") from exc

    imports: set[str] = set()
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names.extend(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise PackageCheckError(
                    f"Relative Python import in {path.name} is not covered by the flat Bridge package check."
                )
            if node.module:
                names.append(node.module.split(".", 1)[0])
        elif isinstance(node, ast.Call):
            dynamic_import = (
                isinstance(node.func, ast.Name) and node.func.id == "__import__"
            ) or (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "import_module"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "importlib"
            )
            if dynamic_import:
                if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                    raise PackageCheckError(
                        f"Non-literal dynamic import in {path.name} cannot be checked offline."
                    )
                names.append(node.args[0].value.split(".", 1)[0])

        for name in names:
            if (source_root / f"{name}.py").is_file():
                imports.add(name)
    return imports


def local_import_closure(source_root: Path, entry_point: str = "bridge.py") -> set[str]:
    entry = _safe_package_path(entry_point)
    if "/" in entry or not entry.endswith(".py"):
        raise PackageCheckError("The Bridge entry point must be a sibling Python file.")
    entry_path = source_root / entry
    if not entry_path.is_file():
        raise PackageCheckError(f"Bridge entry point is missing: {entry}.")

    pending = [entry_path.stem]
    visited: set[str] = set()
    while pending:
        module = pending.pop()
        if module in visited:
            continue
        path = source_root / f"{module}.py"
        if not path.is_file():
            raise PackageCheckError(f"Imported local Bridge module is missing: {module}.py.")
        visited.add(module)
        pending.extend(_module_imports(path, source_root) - visited)
    return {f"{module}.py" for module in visited}


def _bridge_api_version(bridge_path: Path) -> int:
    try:
        tree = ast.parse(bridge_path.read_text(encoding="utf-8-sig"), filename=str(bridge_path))
    except (OSError, SyntaxError) as exc:
        raise PackageCheckError(f"Could not parse Bridge API version: {exc}") from exc

    values = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "BRIDGE_API_VERSION"
            for target in node.targets
        ):
            values.append(node.value)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "BRIDGE_API_VERSION":
            values.append(node.value)
    if (
        len(values) != 1
        or not isinstance(values[0], ast.Constant)
        or type(values[0].value) is not int
    ):
        raise PackageCheckError("BRIDGE_API_VERSION must have one literal integer definition in bridge.py.")
    return values[0].value


def inspect_source(repo_root: Path) -> tuple[list[str], int]:
    repo_root = repo_root.resolve()
    source_root = repo_root / "local-bridge"
    publish_script = repo_root / "experiments" / "wallpaper-host-poc" / "scripts" / "Publish-Release.ps1"
    process_manager = repo_root / "experiments" / "wallpaper-host-poc" / "BridgeProcessManager.cs"

    publish_files = _unique_paths(
        _read_list(
            publish_script,
            r"\$BridgeRuntimeFiles\s*=\s*@\((.*?)\)",
            r"(?m)^\s*'([^']+)'\s*,?\s*$",
            "BridgeRuntimeFiles",
        ),
        "Publish-Release.ps1 BridgeRuntimeFiles",
    )
    required_files = _unique_paths(
        _read_list(
            process_manager,
            r"RequiredBridgeFiles\s*=\s*\[(.*?)\]\s*;",
            r'"([^"\r\n]+)"',
            "RequiredBridgeFiles",
        ),
        "BridgeProcessManager.RequiredBridgeFiles",
    )

    for relative_path in publish_files | required_files:
        if not (source_root / relative_path).is_file():
            raise PackageCheckError(f"Listed Bridge runtime source file is missing: {relative_path}.")

    closure = local_import_closure(source_root)
    publish_python = {path for path in publish_files if path.endswith(".py")}
    required_python = {path for path in required_files if path.endswith(".py")}
    if closure != publish_python:
        raise PackageCheckError(
            "Publish allowlist does not equal bridge.py's local import closure; "
            f"missing={sorted(closure - publish_python)}, extra={sorted(publish_python - closure)}."
        )
    if closure != required_python:
        raise PackageCheckError(
            "BridgeProcessManager.RequiredBridgeFiles does not equal the local import closure; "
            f"missing={sorted(closure - required_python)}, extra={sorted(required_python - closure)}."
        )
    if publish_files - required_files != {"start_bridge.ps1"}:
        raise PackageCheckError(
            "The only publish-only Bridge file must remain start_bridge.ps1; "
            f"publish-only={sorted(publish_files - required_files)}."
        )
    if required_files - publish_files:
        raise PackageCheckError(
            "BridgeProcessManager requires files absent from the publish allowlist: "
            f"{sorted(required_files - publish_files)}."
        )

    api_version = _bridge_api_version(source_root / "bridge.py")
    return sorted(publish_files), api_version


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validate_source_matches_artifact(source_root: Path, artifact_root: Path, files: list[str]) -> None:
    for relative_path in files:
        if _sha256(source_root / relative_path) != _sha256(artifact_root / relative_path):
            raise PackageCheckError(f"Packaged Bridge file differs from current source: {relative_path}.")


def write_provenance(
    repo_root: Path,
    artifact_root: Path,
    source_commit: str,
    source_tree_clean: bool,
) -> dict[str, object]:
    files, api_version = inspect_source(repo_root)
    if not _GIT_SHA.fullmatch(source_commit):
        raise PackageCheckError("sourceCommit must be a full 40- or 64-character Git SHA.")

    source_root = repo_root.resolve() / "local-bridge"
    artifact_root = artifact_root.resolve()
    expected_files = set(files)
    entries = list(artifact_root.iterdir())
    if any(not entry.is_file() for entry in entries):
        raise PackageCheckError("Scratch Bridge artifact must contain files only.")
    actual_files = {entry.name for entry in entries}
    if (
        expected_files - actual_files
        or actual_files - expected_files - {PROVENANCE_NAME}
    ):
        raise PackageCheckError(
            "Scratch Bridge artifact file set differs from the publish allowlist; "
            f"missing={sorted(expected_files - actual_files)}, extra={sorted(actual_files - expected_files)}."
        )
    _validate_source_matches_artifact(source_root, artifact_root, files)

    record: dict[str, object] = {
        "formatVersion": FORMAT_VERSION,
        "sourceCommit": source_commit,
        "sourceTreeClean": source_tree_clean,
        "bridgeApiVersion": api_version,
        "files": [{"path": name, "sha256": _sha256(artifact_root / name)} for name in files],
    }
    (artifact_root / PROVENANCE_NAME).write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return record


def verify_provenance(
    repo_root: Path,
    artifact_root: Path,
    expected_source_commit: str | None = None,
) -> dict[str, object]:
    files, api_version = inspect_source(repo_root)
    source_root = repo_root.resolve() / "local-bridge"
    artifact_root = artifact_root.resolve()
    manifest_path = artifact_root / PROVENANCE_NAME
    try:
        record = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PackageCheckError(f"Bridge provenance record is missing or invalid: {exc}") from exc

    if not isinstance(record, dict) or set(record) != {
        "formatVersion", "sourceCommit", "sourceTreeClean", "bridgeApiVersion", "files"
    }:
        raise PackageCheckError("Bridge provenance fields do not match format version 1.")
    if record["formatVersion"] != FORMAT_VERSION:
        raise PackageCheckError(f"Unsupported Bridge provenance format: {record['formatVersion']}.")
    if not isinstance(record["sourceCommit"], str) or not _GIT_SHA.fullmatch(record["sourceCommit"]):
        raise PackageCheckError("Bridge provenance sourceCommit is not a full Git SHA.")
    if expected_source_commit is not None and record["sourceCommit"] != expected_source_commit:
        raise PackageCheckError(
            f"Bridge provenance source revision mismatch: expected {expected_source_commit}, "
            f"found {record['sourceCommit']}."
        )
    if not isinstance(record["sourceTreeClean"], bool):
        raise PackageCheckError("Bridge provenance sourceTreeClean must be boolean.")
    if record["bridgeApiVersion"] != api_version:
        raise PackageCheckError(
            f"Bridge provenance API version mismatch: expected {api_version}, found {record['bridgeApiVersion']}."
        )

    manifest_files = record["files"]
    if not isinstance(manifest_files, list):
        raise PackageCheckError("Bridge provenance files must be a list.")
    manifest_paths: list[str] = []
    seen_paths: set[str] = set()
    for entry in manifest_files:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            raise PackageCheckError("Bridge provenance file entries must contain only path and sha256.")
        path = _safe_package_path(entry["path"] if isinstance(entry["path"], str) else "")
        if path in seen_paths:
            raise PackageCheckError(f"Duplicate path in Bridge provenance: {path}.")
        seen_paths.add(path)
        if not isinstance(entry["sha256"], str) or not _SHA256.fullmatch(entry["sha256"]):
            raise PackageCheckError(f"Invalid SHA-256 for packaged Bridge file: {path}.")
        manifest_paths.append(path)
        artifact_file = artifact_root / path
        if not artifact_file.is_file():
            raise PackageCheckError(f"Packaged Bridge file is missing: {path}.")
        if _sha256(artifact_file) != entry["sha256"]:
            raise PackageCheckError(f"Packaged Bridge file hash mismatch: {path}.")
        if _sha256(source_root / path) != entry["sha256"]:
            raise PackageCheckError(f"Packaged Bridge file differs from current source: {path}.")

    if manifest_paths != files:
        raise PackageCheckError(
            "Bridge provenance file list differs from the publish allowlist; "
            f"expected={files}, found={manifest_paths}."
        )
    expected_artifact_files = set(files) | {PROVENANCE_NAME}
    artifact_entries = list(artifact_root.iterdir())
    if any(not entry.is_file() for entry in artifact_entries):
        raise PackageCheckError("Packaged Bridge artifact must contain files only.")
    actual_artifact_files = {entry.name for entry in artifact_entries}
    if actual_artifact_files != expected_artifact_files:
        raise PackageCheckError(
            "Packaged Bridge artifact contents differ from provenance; "
            f"missing={sorted(expected_artifact_files - actual_artifact_files)}, "
            f"extra={sorted(actual_artifact_files - expected_artifact_files)}."
        )
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--artifact-root", type=Path)
    parser.add_argument("--source-commit")
    parser.add_argument("--source-tree-clean", choices=("true", "false"))
    parser.add_argument("--write-provenance", action="store_true")
    args = parser.parse_args(argv)

    try:
        files, api_version = inspect_source(args.repo_root)
        if args.artifact_root is None:
            if args.write_provenance:
                raise PackageCheckError("--write-provenance requires --artifact-root.")
            print(f"Bridge source package is complete: {len(files)} files; API v{api_version}.")
            return 0

        if args.write_provenance:
            if args.source_commit is None or args.source_tree_clean is None:
                raise PackageCheckError(
                    "Writing provenance requires --source-commit and --source-tree-clean."
                )
            write_provenance(
                args.repo_root,
                args.artifact_root,
                args.source_commit,
                args.source_tree_clean == "true",
            )
        record = verify_provenance(args.repo_root, args.artifact_root, args.source_commit)
        print(
            f"Bridge artifact verified: API v{record['bridgeApiVersion']}, "
            f"source {record['sourceCommit']}, {len(record['files'])} files."
        )
        return 0
    except (OSError, PackageCheckError) as exc:
        print(f"Bridge package check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
