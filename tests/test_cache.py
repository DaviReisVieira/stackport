import threading
import time

from backend.cache import TTLCache


class TestTTLCache:
    def test_set_and_get(self):
        c = TTLCache()
        c.set("k", "v", ttl=10)
        assert c.get("k") == "v"

    def test_get_missing_key(self):
        c = TTLCache()
        assert c.get("missing") is None

    def test_expiry(self):
        c = TTLCache()
        c.set("k", "v", ttl=0.1)
        time.sleep(0.15)
        assert c.get("k") is None

    def test_overwrite(self):
        c = TTLCache()
        c.set("k", "v1", ttl=10)
        c.set("k", "v2", ttl=10)
        assert c.get("k") == "v2"

    def test_thread_safety(self):
        c = TTLCache()
        errors = []

        def writer(n: int):
            try:
                for i in range(100):
                    c.set(f"key-{n}-{i}", i, ttl=5)
            except Exception as e:
                errors.append(e)

        def reader():
            try:
                for _ in range(100):
                    c.get("key-0-0")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(5)]
        threads += [threading.Thread(target=reader) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == []

    def test_different_types(self):
        c = TTLCache()
        c.set("dict", {"a": 1}, ttl=10)
        c.set("list", [1, 2, 3], ttl=10)
        c.set("int", 42, ttl=10)
        assert c.get("dict") == {"a": 1}
        assert c.get("list") == [1, 2, 3]
        assert c.get("int") == 42
