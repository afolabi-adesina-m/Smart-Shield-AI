import Svg, { Polygon, Rect, Text as SvgText } from "react-native-svg";
import {
  STOP_FONT_SIZE,
  STOP_PLATE_FONT,
  STOP_PLATE_HEIGHT,
  STOP_PLATE_WIDTH,
  STOP_RED,
  STOP_SHADOW_DX,
  STOP_SHADOW_DY,
  STOP_STROKE,
  octagonPoints,
  stopLayout,
} from "./stopSign";

/** Native map marker. Same geometry as the SVG string used in the browser preview. */
export function StopSign({ allWay }: { allWay: boolean }) {
  const box = stopLayout(allWay);
  const face = octagonPoints(box.cx, box.cy, box.radius);
  const shadow = octagonPoints(box.cx + STOP_SHADOW_DX, box.cy + STOP_SHADOW_DY, box.radius);
  return (
    <Svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`}>
      <Polygon points={shadow} fill="rgba(0,0,0,0.34)" />
      <Polygon
        points={face}
        fill={STOP_RED}
        stroke="#ffffff"
        strokeWidth={STOP_STROKE}
        strokeLinejoin="miter"
        strokeMiterlimit={2}
      />
      <SvgText
        x={box.cx}
        y={box.cy}
        fill="#ffffff"
        fontSize={STOP_FONT_SIZE}
        fontWeight="800"
        textAnchor="middle"
        alignmentBaseline="central"
        letterSpacing={0.28}
      >
        STOP
      </SvgText>
      {allWay ? (
        <>
          <Rect
            x={box.plateLeft}
            y={box.plateTop}
            width={STOP_PLATE_WIDTH}
            height={STOP_PLATE_HEIGHT}
            rx={2.2}
            fill="#ffffff"
          />
          <SvgText
            x={box.cx}
            y={box.plateTop + STOP_PLATE_HEIGHT / 2}
            fill="#202124"
            fontSize={STOP_PLATE_FONT}
            fontWeight="700"
            textAnchor="middle"
            alignmentBaseline="central"
            letterSpacing={0.2}
          >
            ALL WAY
          </SvgText>
        </>
      ) : null}
    </Svg>
  );
}
