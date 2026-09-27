"""Browser map tiles. OpenStreetMap is the default and needs no API key.

An optional keyed style is used only when the operator sets ``MAP_TILE_URL``
or a public Mapbox token (``pk.``). Secret tokens are never sent to the browser.
"""

from __future__ import annotations

import os

OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
OSM_MAX_ZOOM = 19
OSM_ATTRIBUTION = "© OpenStreetMap contributors"


def map_tile_settings(environ: dict | None = None) -> dict:
    """Public tile settings. ``url`` is empty when the browser should use OSM."""
    env = os.environ if environ is None else environ
    explicit = (env.get("MAP_TILE_URL") or "").strip()
    dark = (env.get("MAP_TILE_URL_DARK") or "").strip()
    token = (env.get("MAPBOX_ACCESS_TOKEN") or "").strip()
    attribution = (env.get("MAP_TILE_ATTRIBUTION") or "").strip()
    subdomains = (env.get("MAP_TILE_SUBDOMAINS") or "").strip()
    try:
        max_zoom = int((env.get("MAP_TILE_MAX_ZOOM") or str(OSM_MAX_ZOOM)).strip())
    except ValueError:
        max_zoom = OSM_MAX_ZOOM
    max_zoom = max(1, min(max_zoom, 22))

    if explicit:
        return {
            "provider": "custom",
            "url": explicit,
            "dark_url": dark,
            "max_zoom": max_zoom,
            "attribution": attribution or OSM_ATTRIBUTION,
            "subdomains": subdomains,
            "key_required": False,
        }

    # Geocoding may use a secret token. Only a public pk. token is safe in a tile URL.
    if token.startswith("pk."):
        return {
            "provider": "mapbox",
            "url": (
                "https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}"
                f"?access_token={token}"
            ),
            "dark_url": (
                "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}"
                f"?access_token={token}"
            ),
            "max_zoom": OSM_MAX_ZOOM,
            "attribution": "© Mapbox © OpenStreetMap",
            "subdomains": "",
            "key_required": False,
        }

    return {
        "provider": "osm",
        "url": "",
        "dark_url": "",
        "max_zoom": OSM_MAX_ZOOM,
        "attribution": OSM_ATTRIBUTION,
        "subdomains": "",
        "key_required": False,
    }
