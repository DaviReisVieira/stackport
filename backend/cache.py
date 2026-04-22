import threading
import time


class TTLCache:
    def __init__(self):
        self._store: dict = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            if key in self._store:
                value, expiry = self._store[key]
                if time.time() < expiry:
                    return value
                del self._store[key]
        return None

    def set(self, key: str, value, ttl: float = 5):
        with self._lock:
            self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


cache = TTLCache()
