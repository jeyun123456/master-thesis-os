from pathlib import Path


def safe_path(root: Path, relative: str) -> Path:
    rel = relative.replace('\\', '/').lstrip('/')
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError('Path escapes master_path') from exc
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_file():
        raise ValueError('Only files can be opened')
    return target
