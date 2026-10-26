"""Tests for the Kaggle shot-list compiler (no GPU, no network)."""

from __future__ import annotations

import json

import pytest

from tools.video import kaggle_shots as ks


class TestGeometry:
    def test_spatial_snaps_to_multiple_of_32(self):
        assert ks.snap_spatial(480) == 480
        assert ks.snap_spatial(481) == 480
        assert ks.snap_spatial(500) == 512
        assert ks.snap_spatial(479) == 480

    def test_spatial_never_returns_zero(self):
        assert ks.snap_spatial(1) == 32
        assert ks.snap_spatial(0) == 32

    def test_frames_snap_to_temporal_grid(self):
        for frames in range(1, 200):
            snapped = ks.snap_frames(frames)
            assert (snapped - 1) % 4 == 0, frames
            assert snapped >= 1

    def test_frames_for_seconds_rounds_to_grid(self):
        assert ks.frames_for_seconds(4.0, 24) == 97
        assert ks.frames_for_seconds(2.0, 24) == 49
        assert (ks.frames_for_seconds(3.3, 24) - 1) % 4 == 0

    def test_rejects_bad_input(self):
        with pytest.raises(ValueError):
            ks.snap_frames(0)
        with pytest.raises(ValueError):
            ks.frames_for_seconds(0, 24)
        with pytest.raises(ValueError):
            ks.snap_spatial(100, alignment=0)


class TestBuildShotlist:
    def test_default_list_is_valid_and_vertical(self):
        data = ks.build_shotlist(title="The Ashborn")
        assert ks.validate_shotlist(data) == []
        assert data["aspect"] == "9:16"
        assert len(data["shots"]) == len(ks.BEATS)

    def test_vertical_geometry(self):
        data = ks.build_shotlist(title="t")
        shot = data["shots"][0]
        assert shot["height"] > shot["width"], "9:16 must be taller than wide"
        assert shot["width"] % 32 == 0 and shot["height"] % 32 == 0

    def test_all_shots_are_true_generation_by_default(self):
        data = ks.build_shotlist(title="t")
        assert {s["operation"] for s in data["shots"]} == {"text_to_video"}

    def test_reference_image_switches_only_that_beat(self):
        data = ks.build_shotlist(title="t", reference_images={"hook": "/tmp/hook.png"})
        ops = {s["beat"]: s["operation"] for s in data["shots"]}
        assert ops["hook"] == "image_to_video"
        assert ops["rising"] == "text_to_video"
        assert ks.validate_shotlist(data) == []

    def test_image_to_video_without_reference_is_invalid(self):
        data = ks.build_shotlist(title="t")
        data["shots"][0]["operation"] = "image_to_video"
        assert any("reference_image" in p for p in ks.validate_shotlist(data))

    def test_character_sheet_repeats_in_every_prompt(self):
        data = ks.build_shotlist(title="t")
        for shot in data["shots"]:
            assert ks.DEFAULT_CHARACTER_SHEET in shot["prompt"]
            assert ks.STYLE_BIBLE in shot["prompt"]

    def test_deterministic_for_a_given_seed(self):
        a = ks.build_shotlist(title="t", seed=7)
        b = ks.build_shotlist(title="t", seed=7)
        c = ks.build_shotlist(title="t", seed=8)
        assert json.dumps(a["shots"]) == json.dumps(b["shots"])
        assert [s["seed"] for s in a["shots"]] != [s["seed"] for s in c["shots"]]

    def test_seeds_are_unique(self):
        data = ks.build_shotlist(title="t")
        seeds = [s["seed"] for s in data["shots"]]
        assert len(seeds) == len(set(seeds))

    def test_parts_do_not_collide(self):
        p1 = ks.build_shotlist(title="t", part=1, total_parts=3)
        p2 = ks.build_shotlist(title="t", part=2, total_parts=3)
        assert {s["seed"] for s in p1["shots"]}.isdisjoint({s["seed"] for s in p2["shots"]})
        assert p1["shots"][0]["filename"].startswith("part01_")
        assert p2["shots"][0]["filename"].startswith("part02_")

    def test_hq_profile_is_larger(self):
        std = ks.build_shotlist(title="t", profile="kaggle-t4-9x16")["shots"][0]
        hq = ks.build_shotlist(title="t", profile="kaggle-t4-9x16-hq")["shots"][0]
        assert hq["width"] > std["width"] and hq["height"] > std["height"]
        assert hq["num_inference_steps"] > std["num_inference_steps"]

    def test_rejects_unknown_profile(self):
        with pytest.raises(ValueError):
            ks.build_shotlist(title="t", profile="a100-ultra")

    def test_rejects_bad_part_range(self):
        with pytest.raises(ValueError):
            ks.build_shotlist(title="t", part=4, total_parts=3)
        with pytest.raises(ValueError):
            ks.build_shotlist(title="t", part=0, total_parts=3)

    def test_rejects_blank_title(self):
        with pytest.raises(ValueError):
            ks.build_shotlist(title="   ")


class TestValidate:
    def test_flags_misaligned_geometry(self):
        data = ks.build_shotlist(title="t")
        data["shots"][0]["width"] = 481
        assert any("multiple of 32" in p for p in ks.validate_shotlist(data))

    def test_flags_wrong_frame_grid(self):
        data = ks.build_shotlist(title="t")
        data["shots"][0]["frames"] = 96
        assert any("% 4 == 1" in p for p in ks.validate_shotlist(data))

    def test_flags_empty_prompt_and_bad_operation(self):
        data = ks.build_shotlist(title="t")
        data["shots"][0]["prompt"] = ""
        data["shots"][1]["operation"] = "interpolate_still"
        problems = ks.validate_shotlist(data)
        assert any("prompt is empty" in p for p in problems)
        assert any("unsupported operation" in p for p in problems)

    def test_flags_empty_shot_list(self):
        assert ks.validate_shotlist({"schema_version": 1, "shots": []})

    def test_estimate_scales_with_resolution_and_steps(self):
        std = ks.build_shotlist(title="t")
        hq = ks.build_shotlist(title="t", profile="kaggle-t4-9x16-hq")
        assert ks.estimate_gpu_seconds(hq) > ks.estimate_gpu_seconds(std) > 0


class TestCli:
    def test_writes_then_checks(self, tmp_path, capsys):
        out = tmp_path / "shotlist.json"
        assert ks.main(["--title", "The Ashborn", "--out", str(out)]) == 0
        assert out.exists()
        data = json.loads(out.read_text())
        assert data["title"] == "The Ashborn"

        assert ks.main(["--out", str(out), "--check"]) == 0
        assert "OK:" in capsys.readouterr().out

    def test_check_reports_invalid(self, tmp_path, capsys):
        out = tmp_path / "shotlist.json"
        ks.main(["--title", "t", "--out", str(out)])
        data = json.loads(out.read_text())
        data["shots"][0]["width"] = 481
        out.write_text(json.dumps(data))
        assert ks.main(["--out", str(out), "--check"]) == 1
        assert "INVALID" in capsys.readouterr().out

    def test_refuses_to_write_invalid(self, tmp_path):
        data = ks.build_shotlist(title="t")
        data["shots"][0]["frames"] = 96
        with pytest.raises(ValueError):
            ks.write_shotlist(tmp_path / "bad.json", data)
        assert not (tmp_path / "bad.json").exists()
