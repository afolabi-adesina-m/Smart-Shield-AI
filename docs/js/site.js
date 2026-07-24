(() => {
  const t = document.getElementById("t");
  const v = document.getElementById("v");
  const e = document.getElementById("e");
  const wt = document.getElementById("wt");
  const wv = document.getElementById("wv");
  const we = document.getElementById("we");
  const tVal = document.getElementById("tVal");
  const vVal = document.getElementById("vVal");
  const eVal = document.getElementById("eVal");
  const scoreEl = document.getElementById("score");
  const scoreRing = document.getElementById("scoreRing");
  const riskLabel = document.getElementById("riskLabel");
  const speedAdvice = document.getElementById("speedAdvice");
  const tMeta = document.getElementById("tMeta");
  const vMeta = document.getElementById("vMeta");
  const eMeta = document.getElementById("eMeta");

  function clamp01(x) {
    return Math.min(1, Math.max(0, x));
  }

  function update() {
    const T = clamp01(Number(t.value));
    const V = clamp01(Number(v.value));
    const E = clamp01(Number(e.value));
    let wT = Number(wt.value);
    let wV = Number(wv.value);
    let wE = Number(we.value);
    const sum = wT + wV + wE || 1;
    wT /= sum;
    wV /= sum;
    wE /= sum;

    const S = Math.round((wT * T + wV * V + wE * E) * 100);
    scoreEl.textContent = String(S);
    scoreRing.style.setProperty("--pct", String(S));

    tVal.textContent = T.toFixed(2);
    vVal.textContent = V.toFixed(2);
    eVal.textContent = E.toFixed(2);
    tMeta.textContent = T.toFixed(2);
    vMeta.textContent = V.toFixed(2);
    eMeta.textContent = E.toFixed(2);

    let risk = "Low Risk";
    let color = getComputedStyle(document.documentElement).getPropertyValue("--safe").trim();
    let advice = "Recommended speed: ~100% of posted limit (e.g. 100–110 km/h).";

    if (S >= 71) {
      risk = "High Risk";
      color = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim();
      advice = "Recommended speed: ~60% of posted limit (e.g. 60 km/h). Consider postponing travel.";
    } else if (S >= 31) {
      risk = "Moderate Risk";
      color = getComputedStyle(document.documentElement).getPropertyValue("--warn").trim();
      advice = "Recommended speed: ~80% of posted limit (e.g. 80 km/h).";
    }

    scoreRing.style.setProperty("--score-color", color);
    riskLabel.textContent = risk;
    speedAdvice.textContent = advice;
  }

  [t, v, e, wt, wv, we].forEach((el) => el.addEventListener("input", update));
  update();
})();
