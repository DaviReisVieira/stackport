"""Tests for the Learn progress store."""

from backend.learn_store import LearnProgressStore


class TestLearnProgressStore:
    def test_starts_empty(self, tmp_path):
        store = LearnProgressStore(json_path=tmp_path / "progress.json")
        assert store.get_progress()["completed"] == {}

    def test_mark_step_persists(self, tmp_path):
        path = tmp_path / "progress.json"
        store = LearnProgressStore(json_path=path)
        store.mark_step("trail-1", "lesson-1", "step-1")

        reloaded = LearnProgressStore(json_path=path)
        assert reloaded.get_progress()["completed"] == {"trail-1": {"lesson-1": ["step-1"]}}

    def test_mark_step_idempotent(self, tmp_path):
        store = LearnProgressStore(json_path=tmp_path / "progress.json")
        store.mark_step("t", "l", "s")
        store.mark_step("t", "l", "s")
        assert store.get_progress()["completed"]["t"]["l"] == ["s"]

    def test_reset_single_trail(self, tmp_path):
        store = LearnProgressStore(json_path=tmp_path / "progress.json")
        store.mark_step("t1", "l", "s")
        store.mark_step("t2", "l", "s")
        store.reset("t1")
        completed = store.get_progress()["completed"]
        assert "t1" not in completed
        assert "t2" in completed

    def test_reset_all(self, tmp_path):
        store = LearnProgressStore(json_path=tmp_path / "progress.json")
        store.mark_step("t1", "l", "s")
        store.reset()
        assert store.get_progress()["completed"] == {}

    def test_corrupt_file_recovers(self, tmp_path):
        path = tmp_path / "progress.json"
        path.write_text("{not valid json")
        store = LearnProgressStore(json_path=path)
        assert store.get_progress()["completed"] == {}
        store.mark_step("t", "l", "s")
        assert LearnProgressStore(json_path=path).get_progress()["completed"] == {"t": {"l": ["s"]}}

    def test_unexpected_shape_recovers(self, tmp_path):
        path = tmp_path / "progress.json"
        path.write_text('{"something": "else"}')
        store = LearnProgressStore(json_path=path)
        assert store.get_progress()["completed"] == {}
