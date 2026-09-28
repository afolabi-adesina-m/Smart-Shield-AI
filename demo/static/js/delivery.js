/* Delivery planner. Pickup shading is an estimate from nearby map spots, not live app demand. */

(function () {
  const ESTIMATE_LABEL = "Estimate based on nearby pickup spots, not live app demand";
  const ORDER_KEY = "smartshield.deliveryOrders.v1";
  const POI_KEY = "smartshield.deliveryPois.v1";
  const APPS = [
    ["doordash", "DoorDash"],
    ["uber", "Uber Eats"],
    ["spark", "Spark"],
    ["instacart", "Instacart"],
    ["skip", "Skip"],
    ["other", "Other"],
  ];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let map = null;
  let estimateLayer = null;
  let orderLayer = null;
  let showEstimate = false;
  let showOrders = false;
  let spots = [];
  let orders = [];
  let loadTimer = null;

  function mealWindow(date) {
    const hour = date.getHours();
    if (hour >= 11 && hour < 14) return "lunch";
    if (hour >= 17 && hour < 21) return "dinner";
    return "other";
  }

  function poiWeight(kind, date) {
    const meal = mealWindow(date) !== "other";
    if (kind === "food") return meal ? 1.8 : 0.45;
    return meal ? 0.5 : 1.7;
  }

  function weightCaption(date) {
    const meal = mealWindow(date);
    if (meal === "lunch") return "Lunch hours (11–14): restaurants, fast food, and cafes count more.";
    if (meal === "dinner") return "Dinner hours (17–21): restaurants, fast food, and cafes count more.";
    return "Outside lunch and dinner: grocery and pharmacy spots count more.";
  }

  function cellKey(lat, lon) {
    return `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  }

  function orderPay(order) {
    return Math.round((Number(order.pay) + (Number(order.tip) || 0)) * 100) / 100;
  }

  function appLabel(id) {
    const hit = APPS.find((item) => item[0] === id);
    return hit ? hit[1] : "Other";
  }

  function readOrders() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeOrders(next) {
    orders = next.slice(0, 400);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(orders)); } catch (err) { /* stays in memory */ }
  }

  function readSpots(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(POI_KEY) || "null");
      const cell = saved && saved.cells && saved.cells[key];
      if (cell && cell.at && Date.now() - cell.at < 6 * 60 * 60 * 1000 && Array.isArray(cell.spots)) return cell.spots;
    } catch (err) { /* lookup again */ }
    return null;
  }

  function writeSpots(key, list) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(POI_KEY) || "{}") || {}; } catch (err) { saved = {}; }
    const cells = Object.assign({}, saved.cells || {});
    cells[key] = { at: Date.now(), spots: list };
    const names = Object.keys(cells).slice(-8);
    const trimmed = {};
    names.forEach((name) => { trimmed[name] = cells[name]; });
    try { localStorage.setItem(POI_KEY, JSON.stringify({ cells: trimmed })); } catch (err) { /* memory still has them */ }
  }

  function classify(tags) {
    if (!tags) return null;
    const amenity = tags.amenity || "";
    if (amenity === "restaurant" || amenity === "fast_food" || amenity === "cafe") return "food";
    const shop = tags.shop || "";
    if (shop === "supermarket" || shop === "convenience" || shop === "chemist" || amenity === "pharmacy") return "grocery";
    const brand = `${tags.brand || ""} ${tags.name || ""}`.toLowerCase();
    if (/walmart|shoppers|loblaws|no frills|superstore|sobeys|rexall|costco|freshco|walgreens|\bcvs\b|\bmetro\b/.test(brand)) return "grocery";
    return null;
  }

  function queryFor(lat, lon) {
    const around = `around:1600,${lat},${lon}`;
    return `[out:json][timeout:18];(` +
      `node["amenity"="restaurant"](${around});` +
      `node["amenity"="fast_food"](${around});` +
      `node["amenity"="cafe"](${around});` +
      `node["shop"="supermarket"](${around});` +
      `node["shop"="convenience"](${around});` +
      `node["shop"="chemist"](${around});` +
      `node["amenity"="pharmacy"](${around});` +
      `node["brand"~"Walmart|Shoppers|Loblaws|No Frills|Superstore|Sobeys|Rexall|Costco|FreshCo",i](${around});` +
      `);out body 180;`;
  }

  async function fetchSpots(lat, lon) {
    const key = cellKey(lat, lon);
    const cached = readSpots(key);
    if (cached) return cached;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: `data=${encodeURIComponent(queryFor(lat, lon))}`,
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const data = await response.json();
      const list = [];
      (data.elements || []).forEach((element) => {
        if (element.lat == null || element.lon == null) return;
        const kind = classify(element.tags);
        if (!kind) return;
        list.push({ lat: element.lat, lon: element.lon, kind });
      });
      writeSpots(key, list);
      return list;
    } catch (err) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  function clearLayers() {
    if (!map) return;
    if (estimateLayer) map.removeLayer(estimateLayer);
    if (orderLayer) map.removeLayer(orderLayer);
    estimateLayer = null;
    orderLayer = null;
  }

  function draw() {
    if (!map || typeof L === "undefined") return;
    clearLayers();
    const now = new Date();
    if (showEstimate && spots.length) {
      const points = spots.map((spot) => [spot.lat, spot.lon, poiWeight(spot.kind, now)]);
      if (typeof L.heatLayer === "function") {
        estimateLayer = L.heatLayer(points, {
          radius: 36,
          blur: 28,
          maxZoom: 17,
          max: 1.8,
          minOpacity: 0.55,
          gradient: { 0.15: "#f6e27a", 0.4: "#f5a142", 0.7: "#e23b2f", 1: "#b00020" },
        }).addTo(map);
      } else {
        estimateLayer = L.layerGroup();
        points.forEach((point) => {
          L.circle([point[0], point[1]], {
            radius: 180,
            color: "#e23b2f",
            weight: 0,
            fillColor: "#e23b2f",
            fillOpacity: 0.18 + (point[2] / 1.8) * 0.35,
          }).addTo(estimateLayer);
        });
        estimateLayer.addTo(map);
      }
    }
    if (showOrders && orders.length) {
      orderLayer = L.layerGroup();
      orders.forEach((order) => {
        const pay = orderPay(order);
        L.circleMarker([order.lat, order.lon], {
          radius: Math.max(7, Math.min(16, 6 + pay / 8)),
          color: "#ffffff",
          weight: 2,
          fillColor: "#1a56db",
          fillOpacity: 0.9,
        }).bindTooltip(`${appLabel(order.app)} $${pay.toFixed(2)}`, { sticky: true }).addTo(orderLayer);
      });
      orderLayer.addTo(map);
    }
    const chip = document.getElementById("delivery-chip");
    if (chip) chip.hidden = !showEstimate;
    const pressed = document.getElementById("nav-delivery");
    if (pressed) pressed.setAttribute("aria-pressed", showEstimate || sheetOpen() ? "true" : "false");
  }

  function sheetOpen() {
    const layer = document.getElementById("delivery-layer");
    return !!(layer && !layer.hidden);
  }

  function hourKey(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso).slice(0, 13);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}T${hour}`;
  }

  function summarize(list) {
    function group(keyFn) {
      const groups = new Map();
      list.forEach((order) => {
        const key = keyFn(order);
        const bucket = groups.get(key) || [];
        bucket.push(order);
        groups.set(key, bucket);
      });
      return [...groups.entries()].map(([key, bucket]) => {
        const pay = Math.round(bucket.reduce((sum, order) => sum + orderPay(order), 0) * 100) / 100;
        const hours = new Set(bucket.map((order) => hourKey(order.at))).size || 1;
        return { key, orders: bucket.length, pay, hours, perHour: Math.round((pay / hours) * 100) / 100 };
      });
    }
    const byApp = group((order) => order.app).sort((a, b) => b.perHour - a.perHour);
    const byWeekday = group((order) => String(new Date(order.at).getDay())).sort((a, b) => Number(a.key) - Number(b.key));
    const byHour = group((order) => String(new Date(order.at).getHours()));
    const bestHours = [...byHour].sort((a, b) => b.perHour - a.perHour).slice(0, 3);
    const areas = group((order) => cellKey(order.lat, order.lon))
      .map((row) => {
        const [lat, lon] = row.key.split(",").map(Number);
        return Object.assign(row, { label: `Near ${lat.toFixed(2)}, ${lon.toFixed(2)}` });
      })
      .sort((a, b) => b.pay - a.pay)
      .slice(0, 3);
    return { byApp, byWeekday, byHour: [...byHour].sort((a, b) => Number(a.key) - Number(b.key)), bestHours, areas };
  }

  function line(text) {
    const el = document.createElement("p");
    el.textContent = text;
    return el;
  }

  function renderSummary() {
    const root = document.getElementById("delivery-summary");
    if (!root) return;
    root.replaceChildren();
    if (!orders.length) {
      root.appendChild(line("Log an order to see your hours and areas. This is your own list, not app demand."));
      return;
    }
    const summary = summarize(orders);
    const note = line("Dollars per hour counts each clock hour once when it has a logged order. Tips are included. This is your own log, not live app demand.");
    root.appendChild(note);
    addBlock(root, "Best hours", summary.bestHours.map((row) => `${row.key.padStart(2, "0")}:00 · $${row.perHour.toFixed(2)}/hour`));
    addBlock(root, "Best areas", summary.areas.map((row) => `${row.label} · $${row.pay.toFixed(2)} · $${row.perHour.toFixed(2)}/hour`));
    addBlock(root, "Per app", summary.byApp.map((row) => `${appLabel(row.key)} · $${row.perHour.toFixed(2)}/hour · $${row.pay.toFixed(2)} · ${row.orders} orders`));
    addBlock(root, "Per weekday", summary.byWeekday.map((row) => `${WEEKDAYS[Number(row.key)] || row.key} · $${row.perHour.toFixed(2)}/hour`));
    addBlock(root, "Per hour", summary.byHour.map((row) => `${row.key.padStart(2, "0")}:00 · $${row.perHour.toFixed(2)}/hour · ${row.orders} orders`));
  }

  function addBlock(root, title, rows) {
    const heading = document.createElement("h4");
    heading.textContent = title;
    root.appendChild(heading);
    if (!rows.length) root.appendChild(line("None yet."));
    rows.forEach((text) => root.appendChild(line(text)));
  }

  function csvCell(value) {
    const text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function exportCsv() {
    const header = ["logged_at", "app", "pay", "tip", "miles", "lat", "lon", "fleet_trip_id"];
    const lines = [header.join(",")];
    orders.forEach((order) => {
      lines.push([
        order.at, order.app, order.pay, order.tip, order.miles, order.lat, order.lon, order.fleetTripId,
      ].map(csvCell).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "smart-shield-delivery.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function fleetSnapshot() {
    const api = window.SmartShieldFleet;
    if (!api || typeof api.events !== "function") return null;
    const events = api.events() || [];
    if (!events.length) return null;
    const first = events[0] && (events[0].time_iso || events[0].t) || "session";
    return { id: `fleet-${first}`, events: events.length, score: typeof api.score === "function" ? api.score() : null };
  }

  function refreshFleet() {
    const box = document.getElementById("delivery-fleet");
    const meta = document.getElementById("delivery-fleet-meta");
    const snap = fleetSnapshot();
    if (box) {
      box.disabled = !snap;
      if (!snap) box.checked = false;
    }
    if (meta) {
      meta.textContent = snap
        ? `Fleet trip on this page: score ${snap.score == null ? "—" : snap.score}, ${snap.events} events.`
        : "No fleet trip is on this page yet.";
    }
  }

  function placeText(fix) {
    const el = document.getElementById("delivery-place");
    if (!el || !fix) return;
    el.textContent = `Pickup ${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)} · ${fix.source === "gps" ? "this device" : "map centre"} · ${new Date().toLocaleString()}`;
  }

  function currentFix() {
    return new Promise((resolve) => {
      const center = map ? map.getCenter() : { lat: 43.6532, lng: -79.3832 };
      const fallback = { lat: center.lat, lon: center.lng, source: "map" };
      if (!navigator.geolocation) {
        resolve(fallback);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: "gps" }),
        () => resolve(fallback),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 20000 },
      );
    });
  }

  async function refreshSpots() {
    if (!map) return;
    const center = map.getCenter();
    const note = document.getElementById("delivery-note");
    spots = await fetchSpots(center.lat, center.lng);
    if (note) {
      note.textContent = spots.length
        ? `${spots.length} pickup spots in this view. ${weightCaption(new Date())}`
        : "Pickup spots did not load. The estimate appears when OpenStreetMap answers.";
    }
    const caption = document.getElementById("delivery-caption");
    if (caption) caption.textContent = weightCaption(new Date());
    draw();
  }

  function scheduleSpots() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(() => { refreshSpots(); }, 350);
  }

  function openSheet() {
    const layer = document.getElementById("delivery-layer");
    if (!layer) return;
    layer.hidden = false;
    showEstimate = true;
    const heat = document.getElementById("delivery-heat");
    if (heat) heat.checked = true;
    refreshFleet();
    currentFix().then(placeText);
    scheduleSpots();
    renderSummary();
    draw();
  }

  function closeSheet() {
    const layer = document.getElementById("delivery-layer");
    if (layer) layer.hidden = true;
    draw();
  }

  function logOrder(event) {
    event.preventDefault();
    const pay = Number(document.getElementById("delivery-pay").value);
    if (!Number.isFinite(pay) || pay < 0) return;
    const tipRaw = document.getElementById("delivery-tip").value.trim();
    const milesRaw = document.getElementById("delivery-miles").value.trim();
    const tip = tipRaw === "" ? null : Number(tipRaw);
    const miles = milesRaw === "" ? null : Number(milesRaw);
    const fleetBox = document.getElementById("delivery-fleet");
    const snap = fleetBox && fleetBox.checked ? fleetSnapshot() : null;
    currentFix().then((fix) => {
      const order = {
        id: new Date().toISOString(),
        app: document.getElementById("delivery-app").value,
        pay,
        tip: tip != null && Number.isFinite(tip) ? tip : null,
        miles: miles != null && Number.isFinite(miles) ? miles : null,
        at: new Date().toISOString(),
        lat: fix.lat,
        lon: fix.lon,
        fleetTripId: snap ? snap.id : null,
      };
      writeOrders([order].concat(orders));
      document.getElementById("delivery-pay").value = "";
      document.getElementById("delivery-tip").value = "";
      document.getElementById("delivery-miles").value = "";
      const saved = document.getElementById("delivery-saved");
      if (saved) saved.textContent = "Saved on this device.";
      showOrders = true;
      const mine = document.getElementById("delivery-orders");
      if (mine) mine.checked = true;
      placeText(fix);
      renderSummary();
      draw();
    });
  }

  function mount() {
    const stack = document.querySelector(".nav-side-stack");
    if (!stack || document.getElementById("nav-delivery")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "nav-delivery";
    button.className = "nav-round";
    button.setAttribute("aria-label", "Delivery");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<span class="nav-bag" aria-hidden="true"></span>';
    stack.appendChild(button);
    button.addEventListener("click", () => {
      if (sheetOpen()) closeSheet();
      else openSheet();
    });

    const layer = document.createElement("div");
    layer.id = "delivery-layer";
    layer.className = "delivery-layer";
    layer.hidden = true;
    const options = APPS.map((item) => `<option value="${item[0]}">${item[1]}</option>`).join("");
    layer.innerHTML = `
      <button type="button" class="delivery-back" id="delivery-back" aria-label="Close delivery"></button>
      <section class="delivery-sheet" role="dialog" aria-labelledby="delivery-title">
        <div class="delivery-head">
          <h2 id="delivery-title">Delivery</h2>
          <button type="button" class="delivery-close" id="delivery-close">Close</button>
        </div>
        <p class="delivery-estimate" id="delivery-estimate">${ESTIMATE_LABEL}</p>
        <p class="delivery-caption" id="delivery-caption"></p>
        <div class="delivery-toggles">
          <label><input type="checkbox" id="delivery-heat" checked /> Pickup estimate</label>
          <label><input type="checkbox" id="delivery-orders" /> My orders</label>
        </div>
        <p class="delivery-note" id="delivery-note"></p>
        <h3>Log order</h3>
        <form class="delivery-form" id="delivery-form">
          <label>App
            <select id="delivery-app">${options}</select>
          </label>
          <label>Pay $
            <input id="delivery-pay" inputmode="decimal" autocomplete="off" />
          </label>
          <label>Tip $ <span class="delivery-meta">optional</span>
            <input id="delivery-tip" inputmode="decimal" autocomplete="off" />
          </label>
          <label>Miles <span class="delivery-meta">optional</span>
            <input id="delivery-miles" inputmode="decimal" autocomplete="off" />
          </label>
          <p class="delivery-meta" id="delivery-place"></p>
          <label class="delivery-check"><input type="checkbox" id="delivery-fleet" /> Link the fleet trip on this page</label>
          <p class="delivery-meta" id="delivery-fleet-meta"></p>
          <button type="submit" class="delivery-log" id="delivery-log">Log order</button>
          <p class="delivery-saved" id="delivery-saved"></p>
        </form>
        <h3>Your summary</h3>
        <div class="delivery-summary" id="delivery-summary"></div>
        <button type="button" class="delivery-export" id="delivery-export">Export CSV</button>
      </section>
    `;
    document.body.appendChild(layer);
    const chip = document.createElement("p");
    chip.id = "delivery-chip";
    chip.className = "delivery-chip";
    chip.hidden = true;
    chip.textContent = ESTIMATE_LABEL;
    document.body.appendChild(chip);

    document.getElementById("delivery-back").addEventListener("click", closeSheet);
    document.getElementById("delivery-close").addEventListener("click", closeSheet);
    document.getElementById("delivery-form").addEventListener("submit", logOrder);
    document.getElementById("delivery-export").addEventListener("click", exportCsv);
    document.getElementById("delivery-heat").addEventListener("change", (event) => {
      showEstimate = event.target.checked;
      if (showEstimate) scheduleSpots();
      else draw();
    });
    document.getElementById("delivery-orders").addEventListener("change", (event) => {
      showOrders = event.target.checked;
      draw();
    });
    orders = readOrders();
    renderSummary();
    document.getElementById("delivery-caption").textContent = weightCaption(new Date());
  }

  function attach(next) {
    map = next;
    map.on("moveend", () => {
      if (showEstimate) scheduleSpots();
    });
    if (showEstimate) scheduleSpots();
  }

  function waitForMap() {
    const next = window.SmartShieldMap && window.SmartShieldMap();
    if (next) attach(next);
    else setTimeout(waitForMap, 200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { mount(); waitForMap(); });
  else { mount(); waitForMap(); }
})();
