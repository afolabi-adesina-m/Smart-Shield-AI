/** Local sunrise and sunset. Night is before sunrise or after sunset. */

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number): number {
  return (radiansValue * 180) / Math.PI;
}

function wrap360(value: number): number {
  return ((value % 360) + 360) % 360;
}

function wrap24(value: number): number {
  return ((value % 24) + 24) % 24;
}

function dayOfYear(when: Date): number {
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()) - start) / 86400000);
}

/** UTC hour of sunrise or sunset. Null inside polar day or night. */
function eventHour(lat: number, lon: number, when: Date, rising: boolean): number | null {
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

function utcHourToDate(when: Date, hour: number): Date {
  const midnight = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
  return new Date(midnight + hour * 3600 * 1000);
}

export function sunTimes(lat: number, lon: number, when = new Date()): { rise: Date; set: Date } | null {
  const riseHour = eventHour(lat, lon, when, true);
  const setHour = eventHour(lat, lon, when, false);
  if (riseHour == null || setHour == null) return null;
  return { rise: utcHourToDate(when, riseHour), set: utcHourToDate(when, setHour) };
}

function sunsetAfterRise(sun: { rise: Date; set: Date }): Date {
  return sun.set.getTime() <= sun.rise.getTime()
    ? new Date(sun.set.getTime() + 86400000)
    : sun.set;
}

/** True at night for this place and time. Null when the sun does not rise or set. */
export function isNight(lat: number, lon: number, when = new Date()): boolean | null {
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
