import json
from dataclasses import dataclass
from pathlib import Path

from bridge_security import PRODUCTION_ORIGIN, valid_origins


DEFAULT_PORT = 38471
CONFIG_ERROR_EXIT_CODE = 78
DEFAULT_ORIGINS = (
    PRODUCTION_ORIGIN,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
)


class ConfigError(ValueError):
    """A permanent bridge configuration error that should not be retried."""


@dataclass(frozen=True)
class BridgeConfig:
    root: Path
    token: str
    port: int
    origins: set[str]


def load_bridge_config(config_path: Path) -> BridgeConfig:
    if not config_path.exists():
        raise ConfigError('Missing config.json. Copy config.example.json to config.json and edit it.')

    try:
        config = json.loads(config_path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ConfigError(f'Invalid config.json: {exc}') from exc
    if not isinstance(config, dict):
        raise ConfigError('config.json must contain a JSON object.')

    raw_root = config.get('master_path')
    if not isinstance(raw_root, str) or not raw_root.strip():
        raise ConfigError("config.json 'master_path' must be a non-empty string.")
    try:
        root = Path(raw_root).expanduser().resolve()
    except (OSError, RuntimeError, TypeError, ValueError) as exc:
        raise ConfigError(f'Invalid master_path: {exc}') from exc
    if not root.is_dir():
        raise ConfigError(f'master_path is not an existing directory: {root}')

    token = config.get('token', '')
    if not isinstance(token, str):
        raise ConfigError('Bridge token must be a string.')
    if len(token) < 32 or token.startswith('CHANGE-THIS'):
        raise ConfigError('Bridge token must be a non-placeholder value of at least 32 characters.')

    raw_port = config.get('port', DEFAULT_PORT)
    if isinstance(raw_port, bool) or isinstance(raw_port, float):
        raise ConfigError('port must be an integer between 1024 and 65535.')
    try:
        port = int(raw_port)
    except (TypeError, ValueError) as exc:
        raise ConfigError('port must be an integer between 1024 and 65535.') from exc
    if not 1024 <= port <= 65535:
        raise ConfigError('port must be an integer between 1024 and 65535.')

    raw_origins = config.get('allowed_origins', list(DEFAULT_ORIGINS))
    if not isinstance(raw_origins, (list, tuple, set)) or not all(isinstance(origin, str) for origin in raw_origins):
        raise ConfigError('allowed_origins must be a list of origin strings.')
    origins = set(raw_origins)
    try:
        origins_valid = valid_origins(origins)
    except (TypeError, ValueError):
        origins_valid = False
    if not origins_valid:
        raise ConfigError('allowed_origins must include the production origin and explicit localhost URLs only.')

    return BridgeConfig(root=root, token=token, port=port, origins=origins)
