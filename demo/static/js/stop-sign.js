/* Original stop-sign marker. Same geometry as mobile/src/stopSign.ts. */

(function () {
  const STOP_RED = "#D93025";
  const RADIUS = 13.8;
  const STROKE = 1.25;
  const SHADOW_DX = 0.7;
  const SHADOW_DY = 1.2;
  const STOP_FONT = 7.15;
  const PLATE_FONT = 5.4;
  const PLATE_WIDTH = 34;
  const PLATE_HEIGHT = 9;
  const PLATE_GAP = 1.5;

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function octagonPoints(cx, cy, radius) {
    const start = -Math.PI / 2 - Math.PI / 8;
    const parts = [];
    for (let i = 0; i < 8; i += 1) {
      const angle = start + i * (Math.PI / 4);
      parts.push(`${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`);
    }
    return parts.join(" ");
  }

  function stopLayout(allWay) {
    const half = RADIUS * Math.cos(Math.PI / 8);
    const cx = allWay ? 20 : 16;
    const cy = 16;
    const width = allWay ? 40 : 32;
    const plateTop = round(cy + half + STROKE / 2 + PLATE_GAP);
    const height = allWay ? Math.ceil(plateTop + PLATE_HEIGHT + 1) : 32;
    return {
      width,
      height,
      cx,
      cy,
      radius: RADIUS,
      anchorX: cx / width,
      anchorY: cy / height,
      plateLeft: (width - PLATE_WIDTH) / 2,
      plateTop,
    };
  }

  function stopSignSvg(allWay) {
    const box = stopLayout(allWay);
    const face = octagonPoints(box.cx, box.cy, box.radius);
    const shadow = octagonPoints(box.cx + SHADOW_DX, box.cy + SHADOW_DY, box.radius);
    const plate = allWay
      ? `<rect x="${box.plateLeft}" y="${box.plateTop}" width="${PLATE_WIDTH}" height="${PLATE_HEIGHT}" rx="2.2" fill="#ffffff"/>` +
        `<text x="${box.cx}" y="${round(box.plateTop + PLATE_HEIGHT / 2)}" fill="#202124" font-size="${PLATE_FONT}" font-weight="700" font-family="Arial, Helvetica, sans-serif" letter-spacing="0.2" text-anchor="middle" dominant-baseline="central">ALL WAY</text>`
      : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}" shape-rendering="geometricPrecision">` +
      `<polygon points="${shadow}" fill="rgba(0,0,0,0.34)"/>` +
      `<polygon points="${face}" fill="${STOP_RED}" stroke="#ffffff" stroke-width="${STROKE}" stroke-linejoin="miter" stroke-miterlimit="2"/>` +
      `<text x="${box.cx}" y="${box.cy}" fill="#ffffff" font-size="${STOP_FONT}" font-weight="800" font-family="Arial, Helvetica, sans-serif" letter-spacing="0.28" text-anchor="middle" dominant-baseline="central">STOP</text>` +
      plate +
      `</svg>`
    );
  }

  window.SmartShieldStop = {
    svg: stopSignSvg,
    layout: stopLayout,
    red: STOP_RED,
  };
})();
