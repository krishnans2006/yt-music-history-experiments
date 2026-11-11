"""Focused tests for comparison semantics that could change the conclusions."""

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("browser_export_analysis", MODULE_PATH)
analysis = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = analysis
SPEC.loader.exec_module(analysis)


def listen(source, index, identifier, timestamp):
    timestamp_us, time_utc = analysis.parse_timestamp(timestamp)
    return analysis.Listen(
        source=source,
        source_index=index,
        video_id=identifier,
        timestamp_us=timestamp_us,
        time_utc=time_utc,
        title=identifier,
    )


class AnalysisTests(unittest.TestCase):
    def test_timestamp_preserves_microseconds(self):
        microseconds, normalized = analysis.parse_timestamp(
            "2024-12-07T04:36:40.589956Z"
        )
        self.assertEqual(normalized, "2024-12-07T04:36:40.589956Z")
        self.assertEqual(microseconds, 1_733_546_200_589_956)

    def test_takeout_union_uses_max_multiplicity(self):
        event = listen("a", 1, "video", "2025-01-01T00:00:00Z")
        duplicate = listen("b", 1, "video", "2025-01-01T00:00:00Z")
        second_copy = listen("b", 2, "video", "2025-01-01T00:00:00.100Z")
        union = analysis.union_takeout({"a": [event], "b": [duplicate, second_copy]})
        # All three floor to the same second, so max source multiplicity is two.
        self.assertEqual(len(union), 2)

    def test_partition_preserves_extra_repeats_and_missing_takeout_rows(self):
        browser = [
            listen("browser", 1, "video", "2025-01-01T00:00:00.100Z"),
            listen("browser", 2, "video", "2025-01-01T00:03:00.100Z"),
        ]
        takeout = [
            listen("takeout", 1, "video", "2025-01-01T00:00:00Z"),
            listen("takeout", 2, "other", "2025-01-01T01:00:00Z"),
        ]
        matched, additional, missing = analysis.browser_partition(browser, takeout)
        self.assertEqual([item.source_index for item in matched], [1])
        self.assertEqual([item.source_index for item in additional], [2])
        self.assertEqual([item.video_id for item in missing], ["other"])

    def test_html_explicit_cst_is_fixed_utc_minus_six(self):
        parser = analysis.TakeoutHTMLParser("html")
        parser.feed(
            '<div class="outer-cell"><div class="header-cell">YouTube Music</div>'
            '<div class="content-cell mdl-typography--body-1">'
            'Watched <a href="https://music.youtube.com/watch?v=abc">Song</a><br>'
            '<a href="https://www.youtube.com/channel/artist">Artist</a><br>'
            'Jul 1, 2025, 1:00:00 PM CST<br></div></div>'
        )
        parser.close()
        self.assertEqual(parser.listens[0].time_utc, "2025-07-01T19:00:00.000000Z")


if __name__ == "__main__":
    unittest.main()
