import threading
import time

from backend.config import STACKPORT_CACHE_TTL


class TTLCache:
    def __init__(self, default_ttl: int = STACKPORT_CACHE_TTL):
        self._store: dict = {}
        self._lock = threading.Lock()
        self._default_ttl = default_ttl

    def get(self, key: str):
        with self._lock:
            if key in self._store:
                value, expiry = self._store[key]
                if time.time() < expiry:
                    return value
                del self._store[key]
        return None

    def set(self, key: str, value, ttl: float | None = None):
        if ttl is None:
            ttl = self._default_ttl
        with self._lock:
            self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


cache = TTLCache()
