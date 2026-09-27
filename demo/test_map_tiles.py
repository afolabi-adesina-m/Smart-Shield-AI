"""Map tiles stay keyless unless an optional public provider is configured."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from map_tiles import OSM_ATTRIBUTION, OSM_MAX_ZOOM, map_tile_settings  # noqa: E402


class MapTileSettingsTests(unittest.TestCase):
    def test_default_is_openstreetmap_with_no_key(self):
        settings = map_tile_settings({})
        self.assertEqual(settings["provider"], "osm")
        self.assertEqual(settings["url"], "")
        self.assertEqual(settings["max_zoom"], OSM_MAX_ZOOM)
        self.assertEqual(settings["attribution"], OSM_ATTRIBUTION)
        self.assertFalse(settings["key_required"])

    def test_secret_mapbox_token_is_not_sent_to_the_browser(self):
        settings = map_tile_settings({"MAPBOX_ACCESS_TOKEN": "sk.secret-geocoder"})
        self.assertEqual(settings["provider"], "osm")
        self.assertNotIn("sk.secret", settings["url"])
        self.assertNotIn("sk.secret", settings["dark_url"])

    def test_public_mapbox_token_is_optional(self):
        settings = map_tile_settings({"MAPBOX_ACCESS_TOKEN": "pk.public-demo"})
        self.assertEqual(settings["provider"], "mapbox")
        self.assertIn("pk.public-demo", settings["url"])
        self.assertIn("dark-v11", settings["dark_url"])
        self.assertFalse(settings["key_required"])

    def test_explicit_tile_url_wins_and_hides_the_token(self):
        settings = map_tile_settings({
            "MAP_TILE_URL": "https://tiles.example/{z}/{x}/{y}.png",
            "MAP_TILE_URL_DARK": "https://tiles.example/dark/{z}/{x}/{y}.png",
            "MAPBOX_ACCESS_TOKEN": "pk.public-demo",
            "MAP_TILE_MAX_ZOOM": "18",
        })
        self.assertEqual(settings["provider"], "custom")
        self.assertEqual(settings["url"], "https://tiles.example/{z}/{x}/{y}.png")
        self.assertIn("/dark/", settings["dark_url"])
        self.assertEqual(settings["max_zoom"], 18)
        self.assertNotIn("pk.public-demo", settings["url"])


if __name__ == "__main__":
    unittest.main()
