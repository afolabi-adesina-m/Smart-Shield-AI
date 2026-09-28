/* Light and night-driving themes, plus the map tile style that matches them.
   Night follows local sunset. Tiles are OpenStreetMap and need no key. Night
   darkens those same tiles with a CSS filter. A configured public style still
   wins, except CARTO, which now requires a key and is never requested. */

(function () {
  const KEY = "smartshield-theme";
  const HOME = { lat: 43.6532, lon: -79.3832 };

  function radians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function degrees(radiansValue) {
    return (radiansValue * 180) / Math.PI;
  }

  function wrap360(value) {
    return ((value % 360) + 360) % 360;
  }

  function wrap24(value) {
    return ((value % 24) + 24) % 24;
  }

  function dayOfYear(when) {
    const start = Date.UTC(when.getUTCFullYear(), 0, 0);
    return Math.floor((Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()) - start) / 86400000);
  }

  function eventHour(lat, lon, when, rising) {
    const zenith = 90.833;
    const lngHour = lon / 15;
    const t = dayOfYear(when) + ((rising ? 6 : 18) - lngHour) / 24;
    const mean = (0.9856 * t) - 3.289;
    let sunLong = mean + (1.916 * Math.sin(radians(mean))) + (0.020 * Math.sin(radians(2 * mean))) + 282.634;
    sunLong = wrap360(sunLong);
    let rightAsc = degrees(Math.atan(0.91764 * Math.tan(radians(sunLong))));
    rightAsc = wrap360(rightAsc);
    const longQuad = Math.floor(sunLong / 90) * 90;
    const raQuad = Math.floor(rightAsc / 90) * 90;
    rightAsc = (rightAsc + (longQuad - raQuad)) / 15;
    const sinDec = 0.39782 * Math.sin(radians(sunLong));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosHour = (Math.cos(radians(zenith)) - (sinDec * Math.sin(radians(lat)))) / (cosDec * Math.cos(radians(lat)));
    if (cosHour > 1 || cosHour < -1) return null;
    const hourAngle = (rising ? 360 - degrees(Math.acos(cosHour)) : degrees(Math.acos(cosHour))) / 15;
    return wrap24(hourAngle + rightAsc - (0.06571 * t) - 6.622 - lngHour);
  }

  function utcHourToDate(when, hour) {
    const midnight = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
    return new Date(midnight + hour * 3600 * 1000);
  }

  function sunTimes(lat, lon, when) {
    const riseHour = eventHour(lat, lon, when, true);
    const setHour = eventHour(lat, lon, when, false);
    if (riseHour == null || setHour == null) return null;
    return { rise: utcHourToDate(when, riseHour), set: utcHourToDate(when, setHour) };
  }

  function sunsetAfterRise(sun) {
    return sun.set.getTime() <= sun.rise.getTime()
      ? new Date(sun.set.getTime() + 86400000)
      : sun.set;
  }

  function isNight(lat, lon, when) {
    const sun = sunTimes(lat, lon, when);
    if (!sun) return null;
    const set = sunsetAfterRise(sun);
    if (when.getTime() >= sun.rise.getTime() && when.getTime() <= set.getTime()) return false;
    if (when.getTime() < sun.rise.getTime()) {
      const yesterday = new Date(when.getTime() - 86400000);
      const previous = sunTimes(lat, lon, yesterday);
      if (previous && when.getTime() <= sunsetAfterRise(previous).getTime()) return false;
    }
    return true;
  }

  function nightAt(lat, lon, when) {
    const night = isNight(lat, lon, when || new Date());
    if (night == null) {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return true;
      const hour = (when || new Date()).getHours();
      return hour < 7 || hour >= 19;
    }
    return night;
  }

  function savedTheme() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (err) {
      /* private mode */
    }
    return null;
  }

  function preferred() {
    return savedTheme() || (nightAt(HOME.lat, HOME.lon) ? "dark" : "light");
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0e1116" : "#f3f6fb");
    const toDark = theme !== "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.setAttribute("aria-label", toDark ? "Switch to night theme" : "Switch to day theme");
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    });
    document.dispatchEvent(new CustomEvent("smartshield:theme", { detail: { theme } }));
  }

  apply(preferred());

  document.addEventListener("DOMContentLoaded", () => {
    apply(preferred());
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, next); } catch (err) { /* ignore */ }
        apply(next);
      });
    });
    const toggle = document.getElementById("safety-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const section = document.getElementById("routes-section");
        if (section && section.closest("#safety-card")) {
          const open = section.hidden;
          section.hidden = !open;
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          return;
        }
        if (typeof setSheetState === "function") setSheetState("half");
      });
    }
  });

  const OSM = {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  };

  let keyedTiles = null;

  function usableTiles(tiles) {
    if (!tiles || !tiles.url) return null;
    const urls = `${tiles.url} ${tiles.dark_url || ""}`;
    if (/carto\.com|cartocdn\.com/i.test(urls)) return null;
    return tiles;
  }

  function loadKeyedTiles() {
    return fetch("/api/config")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data) => {
        const tiles = (data && data.map_tiles) || {};
        keyedTiles = usableTiles(tiles);
        return keyedTiles;
      })
      .catch(() => {
        keyedTiles = null;
        return null;
      });
  }

  function specFor(theme, forceOsm) {
    const night = theme === "dark";
    if (!forceOsm && keyedTiles && keyedTiles.url) {
      const darkUrl = keyedTiles.dark_url || "";
      return {
        url: night && darkUrl ? darkUrl : keyedTiles.url,
        maxZoom: keyedTiles.max_zoom || OSM.maxZoom,
        attribution: keyedTiles.attribution || OSM.attribution,
        subdomains: keyedTiles.subdomains || "",
        nightFilter: night && !darkUrl,
        provider: keyedTiles.provider || "keyed",
      };
    }
    return {
      url: OSM.url,
      maxZoom: OSM.maxZoom,
      attribution: OSM.attribution,
      subdomains: "",
      nightFilter: night,
      provider: "osm",
    };
  }

  function paintTiles(map, theme) {
    if (!map || typeof L === "undefined") return;
    const spec = specFor(theme, !!map._ssForceOsm);
    const container = map.getContainer();
    container.classList.toggle("tiles-night", !!spec.nightFilter);
    if (map._ssBase) map.removeLayer(map._ssBase);

    const options = {
      maxZoom: spec.maxZoom,
      maxNativeZoom: Math.min(spec.maxZoom, 20),
      attribution: spec.attribution,
    };
    if (spec.subdomains && spec.url.indexOf("{s}") !== -1) {
      options.subdomains = spec.subdomains;
    }
    const layer = L.tileLayer(spec.url, options);
    let failures = 0;
    let successes = 0;
    layer.on("tileerror", () => {
      failures += 1;
      if (spec.provider !== "osm" && !map._ssForceOsm && failures >= 4 && successes === 0) {
        map._ssForceOsm = true;
        paintTiles(map, theme);
      }
    });
    layer.on("tileload", () => {
      successes += 1;
    });
    layer.addTo(map);
    if (layer.bringToBack) layer.bringToBack();
    map._ssBase = layer;
  }

  window.SmartShieldTheme = {
    current() {
      return document.documentElement.getAttribute("data-theme") || "light";
    },
    tileUrl(theme) {
      return specFor(theme || this.current(), false).url;
    },
    nightAt(lat, lon, when) {
      return nightAt(lat, lon, when);
    },
    followSun(lat, lon) {
      if (savedTheme()) return;
      apply(nightAt(lat, lon) ? "dark" : "light");
    },
    attachMap(map) {
      const paint = (theme) => paintTiles(map, theme || this.current());
      paint(this.current());
      document.addEventListener("smartshield:theme", (event) => {
        paint((event.detail || {}).theme || "light");
      });
      loadKeyedTiles().then((tiles) => {
        if (tiles && tiles.url && !map._ssForceOsm) paint(this.current());
      });
    },
  };
})();
