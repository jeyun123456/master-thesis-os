from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import check_bridge_package as package_check


class BridgePackageCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(prefix="bridge-package-check-")
        self.root = Path(self.temporary_directory.name)
        self.repo_root = self.root / "repo"
        self.source_root = self.repo_root / "local-bridge"
        self.publisher = self.repo_root / "experiments" / "wallpaper-host-poc" / "scripts" / "Publish-Release.ps1"
        self.manager = self.repo_root / "experiments" / "wallpaper-host-poc" / "BridgeProcessManager.cs"
        self.artifact_root = self.root / "artifact"
        self.source_root.mkdir(parents=True)
        self.publisher.parent.mkdir(parents=True, exist_ok=True)
        self.manager.parent.mkdir(parents=True, exist_ok=True)
        self.artifact_root.mkdir()
        self._write_source_fixture()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _write_source_fixture(self) -> None:
        sources = {
            "bridge.py": "BRIDGE_API_VERSION = 7\nimport portal_jobs\nfrom mail_jobs import MailJobs\n",
            "portal_jobs.py": "from workspace_store import WorkspaceStore\n",
            "mail_jobs.py": "from workspace_store import WorkspaceStore\n",
            "workspace_store.py": "class WorkspaceStore: pass\n",
            "start_bridge.ps1": "Write-Output 'start'\n",
        }
        for name, content in sources.items():
            (self.source_root / name).write_text(content, encoding="utf-8")
        self._write_lists()

    def _write_lists(self, publisher_files: list[str] | None = None, required_files: list[str] | None = None) -> None:
        python_files = ["bridge.py", "mail_jobs.py", "portal_jobs.py", "workspace_store.py"]
        publisher_files = publisher_files or [*python_files, "start_bridge.ps1"]
        required_files = required_files or python_files
        publisher_values = "\n".join(f"    '{name}'," for name in publisher_files)
        required_values = "\n".join(f'        "{name}",' for name in required_files)
        self.publisher.write_text(f"$BridgeRuntimeFiles = @(\n{publisher_values}\n)\n", encoding="utf-8")
        self.manager.write_text(f"RequiredBridgeFiles =\n[\n{required_values}\n];\n", encoding="utf-8")

    def _create_artifact(self) -> None:
        files, _ = package_check.inspect_source(self.repo_root)
        for name in files:
            shutil.copyfile(self.source_root / name, self.artifact_root / name)

    def test_complete_scratch_package_writes_and_verifies_provenance(self) -> None:
        files, api_version = package_check.inspect_source(self.repo_root)
        self.assertEqual(api_version, 7)
        self.assertEqual(
            set(files),
            {"bridge.py", "mail_jobs.py", "portal_jobs.py", "workspace_store.py", "start_bridge.ps1"},
        )
        self._create_artifact()

        self.assertEqual(
            package_check.main([
                "--repo-root", str(self.repo_root),
                "--artifact-root", str(self.artifact_root),
                "--source-commit", "a" * 40,
                "--source-tree-clean", "false",
                "--write-provenance",
            ]),
            0,
        )
        record = json.loads((self.artifact_root / package_check.PROVENANCE_NAME).read_text(encoding="utf-8"))
        first_serialization = (self.artifact_root / package_check.PROVENANCE_NAME).read_bytes()
        package_check.write_provenance(self.repo_root, self.artifact_root, "a" * 40, False)
        self.assertEqual((self.artifact_root / package_check.PROVENANCE_NAME).read_bytes(), first_serialization)
        verified = package_check.verify_provenance(
            self.repo_root,
            self.artifact_root,
            expected_source_commit="a" * 40,
        )

        self.assertEqual(record, verified)
        self.assertEqual([item["path"] for item in record["files"]], files)

    def test_missing_imported_module_fails_even_if_both_lists_omit_it(self) -> None:
        self._write_lists(
            ["bridge.py", "mail_jobs.py", "workspace_store.py", "start_bridge.ps1"],
            ["bridge.py", "mail_jobs.py", "workspace_store.py"],
        )
        with self.assertRaisesRegex(package_check.PackageCheckError, "local import closure"):
            package_check.inspect_source(self.repo_root)

    def test_publish_and_companion_required_list_mismatch_fails(self) -> None:
        self._write_lists(required_files=["bridge.py", "portal_jobs.py", "workspace_store.py"])
        with self.assertRaisesRegex(package_check.PackageCheckError, "RequiredBridgeFiles"):
            package_check.inspect_source(self.repo_root)

    def test_hash_mismatch_fails(self) -> None:
        self._create_artifact()
        package_check.write_provenance(self.repo_root, self.artifact_root, "b" * 40, True)
        (self.artifact_root / "portal_jobs.py").write_text("# drift\n", encoding="utf-8")

        with self.assertRaisesRegex(package_check.PackageCheckError, "hash mismatch"):
            package_check.verify_provenance(self.repo_root, self.artifact_root)

    def test_missing_packaged_import_fails(self) -> None:
        self._create_artifact()
        package_check.write_provenance(self.repo_root, self.artifact_root, "f" * 40, True)
        (self.artifact_root / "portal_jobs.py").unlink()

        with self.assertRaisesRegex(package_check.PackageCheckError, "file is missing"):
            package_check.verify_provenance(self.repo_root, self.artifact_root)

    def test_source_revision_mismatch_fails(self) -> None:
        self._create_artifact()
        package_check.write_provenance(self.repo_root, self.artifact_root, "c" * 40, True)

        with self.assertRaisesRegex(package_check.PackageCheckError, "source revision mismatch"):
            package_check.verify_provenance(self.repo_root, self.artifact_root, "d" * 40)

    def test_record_contains_only_relative_paths_and_non_secret_diagnostics(self) -> None:
        self._create_artifact()
        package_check.write_provenance(self.repo_root, self.artifact_root, "e" * 40, False)
        serialized = (self.artifact_root / package_check.PROVENANCE_NAME).read_text(encoding="utf-8")
        record = json.loads(serialized)

        self.assertEqual(
            set(record),
            {"formatVersion", "sourceCommit", "sourceTreeClean", "bridgeApiVersion", "files"},
        )
        for item in record["files"]:
            path = item["path"]
            self.assertNotIn("\\", path)
            self.assertNotIn(":", path)
            self.assertFalse(path.startswith("/"))
        self.assertNotIn("privateKey", serialized)
        self.assertNotIn("token", serialized)
        self.assertNotIn(str(self.repo_root), serialized)

    def test_current_bridge_closure_includes_c1_through_c3_owners(self) -> None:
        repository_root = Path(__file__).resolve().parents[1]
        files, api_version = package_check.inspect_source(repository_root)
        closure = package_check.local_import_closure(repository_root / "local-bridge")

        self.assertEqual(api_version, 7)
        self.assertTrue({"mail_jobs.py", "portal_jobs.py", "workspace_store.py"}.issubset(closure))
        self.assertTrue(closure.issubset(set(files)))


if __name__ == "__main__":
    unittest.main()
