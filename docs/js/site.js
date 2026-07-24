(() => {
  const els = {
    t: document.getElementById("t"),
    v: document.getElementById("v"),
    e: document.getElementById("e"),
    wt: document.getElementById("wt"),
    wv: document.getElementById("wv"),
    we: document.getElementById("we"),
    tVal: document.getElementById("tVal"),
    vVal: document.getElementById("vVal"),
    eVal: document.getElementById("eVal"),
    wtVal: document.getElementById("wtVal"),
    wvVal: document.getElementById("wvVal"),
    weVal: document.getElementById("weVal"),
    scoreValue: document.getElementById("scoreValue"),
    scoreValueInline: document.getElementById("scoreValueInline"),
    scoreRing: document.getElementById("scoreRing"),
    riskLabel: document.getElementById("riskLabel"),
    speedAdvice: document.getElementById("speedAdvice"),
    tMeta: document.getElementById("tMeta"),
    vMeta: document.getElementById("vMeta"),
    eMeta: document.getElementById("eMeta"),
  };

  const required = ["t", "v", "e", "wt", "wv", "we", "scoreValue", "scoreRing", "riskLabel", "speedAdvice"];
  if (required.some((k) => !els[k])) {
    console.error("Smart-Shield score UI: missing required elements", required.filter((k) => !els[k]));
    return;
  }

  function clamp01(x) {
    return Math.min(1, Math.max(0, x));
  }

  function cssVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  function update() {
    const T = clamp01(Number(els.t.value));
    const V = clamp01(Number(els.v.value));
    const E = clamp01(Number(els.e.value));
    let wT = Number(els.wt.value);
    let wV = Number(els.wv.value);
    let wE = Number(els.we.value);
    const sum = wT + wV + wE || 1;
    wT /= sum;
    wV /= sum;
    wE /= sum;

    const S = Math.round((wT * T + wV * V + wE * E) * 100);
    const scoreText = String(S);

    els.scoreValue.textContent = scoreText;
    if (els.scoreValueInline) els.scoreValueInline.textContent = scoreText;
    els.scoreRing.style.setProperty("--pct", String(S));

    els.tVal.textContent = T.toFixed(2);
    els.vVal.textContent = V.toFixed(2);
    els.eVal.textContent = E.toFixed(2);
    if (els.wtVal) els.wtVal.textContent = Number(els.wt.value).toFixed(2);
    if (els.wvVal) els.wvVal.textContent = Number(els.wv.value).toFixed(2);
    if (els.weVal) els.weVal.textContent = Number(els.we.value).toFixed(2);
    if (els.tMeta) els.tMeta.textContent = T.toFixed(2);
    if (els.vMeta) els.vMeta.textContent = V.toFixed(2);
    if (els.eMeta) els.eMeta.textContent = E.toFixed(2);

    let risk = "Low Risk";
    let color = cssVar("--safe", "#3dcf8e");
    let advice = "Recommended speed: ~100% of posted limit (e.g. 100–110 km/h).";

    if (S >= 71) {
      risk = "High Risk";
      color = cssVar("--danger", "#ff6b6b");
      advice = "Recommended speed: ~60% of posted limit (e.g. 60 km/h). Consider postponing travel.";
    } else if (S >= 31) {
      risk = "Moderate Risk";
      color = cssVar("--warn", "#f0b429");
      advice = "Recommended speed: ~80% of posted limit (e.g. 80 km/h).";
    }

    els.scoreRing.style.setProperty("--score-color", color);
    els.riskLabel.textContent = risk;
    els.riskLabel.dataset.band = risk.split(" ")[0].toLowerCase();
    els.speedAdvice.textContent = advice;
  }

  ["t", "v", "e", "wt", "wv", "we"].forEach((key) => {
    els[key].addEventListener("input", update);
    els[key].addEventListener("change", update);
  });

  update();
})();
