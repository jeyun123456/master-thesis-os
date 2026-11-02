import hmac
from pathlib import Path
from urllib.parse import urlparse


PRODUCTION_ORIGIN = 'https://master-thesis-os.vercel.app'
LOCAL_ORIGIN_HOSTS = {'localhost', '127.0.0.1'}


def valid_origin(origin: str) -> bool:
    """Allow the exact production origin or an explicitly ported localhost URL."""
    if origin == PRODUCTION_ORIGIN:
        return True
    try:
        parsed = urlparse(origin)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == 'http'
        and parsed.hostname in LOCAL_ORIGIN_HOSTS
        and port is not None
        and parsed.username is None
        and parsed.password is None
        and not parsed.path
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
        and origin == f'http://{parsed.hostname}:{port}'
    )


def valid_origins(origins: set[str]) -> bool:
    return bool(origins) and PRODUCTION_ORIGIN in origins and any(
        origin != PRODUCTION_ORIGIN and valid_origin(origin) for origin in origins
    ) and all(valid_origin(origin) for origin in origins)


def token_matches(supplied: object, expected: str) -> bool:
    return hmac.compare_digest(str(supplied), expected)


def allows_private_network(requested: str) -> bool:
    return requested.lower() == 'true'


def is_link(path: Path) -> bool:
    """Symlink or Windows junction (Path.is_symlink() is False for junctions)."""
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def allowed_bases(root: Path, top_level: str) -> list[Path]:
    """The Vault root, plus the target of a top-level Vault folder that is a link.

    A top-level folder such as 02_Projects may be a junction to another drive
    (e.g. Google Drive). Only that folder's own target is trusted; links deeper
    in the tree still count as escapes.
    """
    bases = [root]
    top = root / top_level if top_level else None
    if top is not None and top.is_dir() and is_link(top):
        bases.append(top.resolve())
    return bases


def _contained_path(root: Path, relative: str) -> Path:
    """Resolve a repository-relative path without allowing vault escape."""
    rel = relative.replace('\\', '/').lstrip('/')
    parts = [part for part in rel.split('/') if part]
    if '..' in parts:
        raise ValueError('Path escapes master_path')
    target = (root / rel).resolve()
    for base in allowed_bases(root, parts[0] if parts else ''):
        try:
            target.relative_to(base)
            return target
        except ValueError:
            continue
    raise ValueError('Path escapes master_path')


def safe_path(root: Path, relative: str) -> Path:
    target = _contained_path(root, relative)
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_file():
        raise ValueError('Only files can be opened')
    return target


def safe_directory(root: Path, relative: str = '') -> Path:
    target = _contained_path(root, relative)
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_dir():
        raise ValueError('Only directories can be opened')
    return target


def safe_folder_target(root: Path, relative: str = '') -> Path:
    """Return a contained directory, or the parent of a contained file."""
    target = _contained_path(root, relative)
    if not target.exists():
        raise FileNotFoundError(str(target))
    if target.is_dir():
        return target
    if target.is_file():
        return target.parent
    raise ValueError('Only files or directories can be opened')


def target_for_endpoint(root: Path, endpoint: str, relative: str) -> Path:
    if endpoint == '/open':
        return safe_path(root, relative)
    if endpoint == '/open-folder':
        return safe_folder_target(root, relative)
    raise ValueError('Unsupported endpoint')
