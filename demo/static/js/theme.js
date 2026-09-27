/* Light and night-driving themes, plus the map tile style that matches them. */

(function () {
  const KEY = "smartshield-theme";

  function preferred() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (err) {
      /* private mode */
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0e1116" : "#f3f6fb");
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      const toDark = theme !== "dark";
      btn.setAttribute("aria-label", toDark ? "Switch to night theme" : "Switch to day theme");
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
    document.dispatchEvent(new CustomEvent("smartshield:theme", { detail: { theme } }));
  }

  apply(document.documentElement.getAttribute("data-theme") || preferred());

  document.addEventListener("DOMContentLoaded", () => {
    apply(document.documentElement.getAttribute("data-theme") || preferred());
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, next); } catch (err) { /* ignore */ }
        apply(next);
      });
    }
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

  function loadKeyedTiles() {
    return fetch("/api/config")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data) => {
        const tiles = (data && data.map_tiles) || {};
        keyedTiles = tiles.url ? tiles : null;
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
      maxNativeZoom: spec.maxZoom,
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
