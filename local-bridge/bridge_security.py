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


def _contained_path(root: Path, relative: str) -> Path:
    """Resolve a repository-relative path without allowing vault escape."""
    rel = relative.replace('\\', '/').lstrip('/')
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError('Path escapes master_path') from exc
    return target


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
