/* Upcoming maneuver and along-route alert window. No network. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NavProgress = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var WINDOW_M = 1500;
  var CORRIDOR_M = 80;
  var PASSED_M = 35;
  var ARRIVE_M = 150;
  var THEN_M = 300;
  var SNAP_M = 25;
  var ON_ROUTE_M = 60;

  function haversineM(lat1, lon1, lat2, lon2) {
    var radius = 6371000;
    var p1 = lat1 * Math.PI / 180;
    var p2 = lat2 * Math.PI / 180;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function maneuverKind(step) {
    var type = String((step && step.type) || "").replace(/[_-]/g, " ").trim().toLowerCase();
    var modifier = String((step && step.modifier) || "").trim().toLowerCase();
    if (type === "arrive") return "arrive";
    if (type.indexOf("roundabout") !== -1 || type === "rotary") return "roundabout";
    if (type === "merge") return "merge";
    if (type === "off ramp" || type === "fork" || type === "exit roundabout") return "exit";
    if (modifier === "uturn") return "uturn";
    if (modifier === "sharp left") return "sharp-left";
    if (modifier === "sharp right") return "sharp-right";
    if (modifier === "left") return "left";
    if (modifier === "right") return "right";
    if (modifier === "slight left") return "slight-left";
    if (modifier === "slight right") return "slight-right";
    return "straight";
  }

  function stepPoint(step) {
    var location = step && step.location;
    if (location && location.length >= 2) return { lat: location[1], lon: location[0] };
    var geometry = step && step.geometry;
    if (geometry && geometry[0] && geometry[0].length >= 2) return { lat: geometry[0][1], lon: geometry[0][0] };
    return null;
  }

  function segmentT(a, b, lat, lon) {
    var midLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    var lonScale = Math.cos(midLat) * 111320;
    var dx = (b[1] - a[1]) * lonScale;
    var dy = (b[0] - a[0]) * 111320;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1) return 0;
    var px = (lon - a[1]) * lonScale;
    var py = (lat - a[0]) * 111320;
    return Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
  }

  function projectAlong(line, lat, lon) {
    if (!line || !line.length) return { alongM: 0, offM: Infinity };
    if (line.length === 1) return { alongM: 0, offM: haversineM(lat, lon, line[0][0], line[0][1]), lat: line[0][0], lon: line[0][1] };
    var along = 0;
    var best = { alongM: 0, offM: Infinity };
    for (var index = 1; index < line.length; index += 1) {
      var start = line[index - 1];
      var end = line[index];
      var length = haversineM(start[0], start[1], end[0], end[1]);
      var t = segmentT(start, end, lat, lon);
      var latP = start[0] + (end[0] - start[0]) * t;
      var lonP = start[1] + (end[1] - start[1]) * t;
      var off = haversineM(lat, lon, latP, lonP);
      if (off < best.offM) best = { alongM: along + length * t, offM: off, lat: latP, lon: lonP };
      along += length;
    }
    return best;
  }

  function roadLabel(name, ref) {
    var cleaned = String(name || "").trim();
    if (cleaned && cleaned !== "Unnamed road") return cleaned;
    var roadRef = String(ref || "").trim();
    if (/^\d{1,4}[A-Z]?$/.test(roadRef)) return "Hwy " + roadRef;
    if (roadRef) return roadRef;
    return "Unnamed road";
  }

  function streetFromStep(step) {
    var labeled = roadLabel(step && step.name, step && step.ref);
    if (labeled !== "Unnamed road") return labeled;
    var instruction = String((step && step.instruction) || "");
    var onto = instruction.match(/\bonto\s+(.+)$/i);
    if (onto && onto[1] && onto[1].trim() && onto[1].trim() !== "Unnamed road") return onto[1].trim();
    return "Unnamed road";
  }

  function toManeuver(item, userAlong) {
    var step = item.step;
    return {
      kind: maneuverKind(step),
      distanceM: Math.max(0, item.alongM - userAlong),
      street: streetFromStep(step),
      atLat: item.point.lat,
      atLon: item.point.lon,
      type: step.type || "",
      modifier: step.modifier || "",
      lanes: step.lanes || [],
    };
  }

  function matchAlong(line, lat, lon, previous) {
    if (!line || line.length < 2) {
      return {
        alongM: 0, offM: Infinity, totalM: 0, remainingM: 0, bearing: 0,
        lat: lat, lon: lon, snapped: false, offRoute: true,
      };
    }
    var best = null;
    var along = 0;
    var prevAlong = previous && typeof previous.alongM === "number" ? previous.alongM : null;
    for (var index = 1; index < line.length; index += 1) {
      var start = line[index - 1];
      var end = line[index];
      var length = haversineM(start[0], start[1], end[0], end[1]);
      var t = segmentT(start, end, lat, lon);
      var latP = start[0] + (end[0] - start[0]) * t;
      var lonP = start[1] + (end[1] - start[1]) * t;
      var off = haversineM(lat, lon, latP, lonP);
      var alongM = along + length * t;
      var score = off;
      if (prevAlong != null) {
        var jump = alongM - prevAlong;
        if (jump < -40) score += (-jump - 40) * 5;
        else if (jump > 150 && off > 12) score += jump - 150;
      }
      var closer = !best || score < best.score - 0.5;
      var earlierTie = best && Math.abs(score - best.score) <= 20 && alongM < best.alongM;
      if (closer || earlierTie) {
        best = {
          score: score,
          alongM: alongM,
          offM: off,
          lat: latP,
          lon: lonP,
          bearing: bearingOf(start, end),
        };
      }
      along += length;
    }
    var snapped = best.offM <= SNAP_M;
    return {
      alongM: best.alongM,
      offM: best.offM,
      totalM: along,
      remainingM: Math.max(0, along - best.alongM),
      bearing: best.bearing,
      lat: snapped ? best.lat : lat,
      lon: snapped ? best.lon : lon,
      snapped: snapped,
      offRoute: best.offM > ON_ROUTE_M,
    };
  }

  function bearingOf(start, end) {
    var p1 = start[0] * Math.PI / 180;
    var p2 = end[0] * Math.PI / 180;
    var dLon = (end[1] - start[1]) * Math.PI / 180;
    var y = Math.sin(dLon) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function smoothBearing(previous, target, maxStep) {
    if (target == null || !isFinite(target)) return previous == null ? 0 : previous;
    var aim = (target % 360 + 360) % 360;
    if (previous == null || !isFinite(previous)) return aim;
    var delta = aim - previous;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    var limit = maxStep == null ? 20 : maxStep;
    var step = Math.max(-limit, Math.min(limit, delta));
    return (previous + step + 360) % 360;
  }

  function navZoom(speedKmh, maneuverM, travelMode) {
    if (travelMode === "walk" || travelMode === "cycle") return 18;
    var speed = speedKmh == null ? 40 : speedKmh;
    var zoom = speed >= 80 ? 15 : speed >= 50 ? 16 : 17;
    if (maneuverM != null && maneuverM < 200) zoom = Math.max(zoom, 18);
    return zoom;
  }

  function continueOn(placed, userAlong, totalM) {
    var road = null;
    placed.forEach(function (item) {
      if (maneuverKind(item.step) === "arrive") return;
      if (item.alongM <= userAlong + PASSED_M) road = item;
    });
    var remaining = Math.max(0, totalM - userAlong);
    if (!road) return null;
    var maneuver = toManeuver(road, userAlong);
    maneuver.kind = remaining <= ARRIVE_M ? "arrive" : "straight";
    maneuver.distanceM = remaining;
    return maneuver;
  }

  function upcomingManeuvers(steps, line, lat, lon, previous) {
    var user = matchAlong(line, lat, lon, previous || null);
    var placed = [];
    (steps || []).forEach(function (step) {
      var point = stepPoint(step);
      if (!point) return;
      var alongM = line && line.length >= 2 ? projectAlong(line, point.lat, point.lon).alongM : 0;
      placed.push({ step: step, point: point, alongM: alongM });
    });
    placed.sort(function (a, b) { return a.alongM - b.alongM; });
    var upcoming = placed.filter(function (item) {
      var ahead = item.alongM - user.alongM;
      if (ahead < -PASSED_M) return false;
      if (maneuverKind(item.step) === "arrive" && ahead > ARRIVE_M) return false;
      return true;
    });
    while (
      upcoming.length > 1
      && upcoming[0].alongM - user.alongM < 40
      && String(upcoming[0].step.type || "").toLowerCase() === "depart"
    ) {
      upcoming.shift();
    }
    var current = upcoming.length ? toManeuver(upcoming[0], user.alongM) : continueOn(placed, user.alongM, user.totalM);
    if (current && current.kind === "arrive" && current.distanceM > ARRIVE_M) {
      current = continueOn(placed, user.alongM, user.totalM) || current;
    }
    var thenItem = upcoming.length > 1 ? upcoming[1] : null;
    if (!thenItem && current && current.kind !== "arrive") {
      var arrive = placed.filter(function (item) { return maneuverKind(item.step) === "arrive"; })[0];
      if (arrive && arrive.alongM - user.alongM <= THEN_M) thenItem = arrive;
    }
    var thenManeuver = thenItem ? toManeuver(thenItem, user.alongM) : null;
    if (thenManeuver && thenManeuver.distanceM > THEN_M) thenManeuver = null;
    var onRoad = "";
    placed.forEach(function (item) {
      if (maneuverKind(item.step) === "arrive") return;
      if (item.alongM <= user.alongM + PASSED_M) onRoad = streetFromStep(item.step);
    });
    return { current: current, then: thenManeuver, match: user, road: onRoad };
  }

  function cutLine(line, alongM) {
    if (!line || line.length < 2) return { traveled: [], ahead: (line || []).slice() };
    var walked = 0;
    for (var index = 1; index < line.length; index += 1) {
      var start = line[index - 1];
      var end = line[index];
      var length = haversineM(start[0], start[1], end[0], end[1]);
      if (walked + length >= alongM || index === line.length - 1) {
        var t = length > 1 ? Math.max(0, Math.min(1, (alongM - walked) / length)) : 1;
        var mid = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
        return { traveled: line.slice(0, index).concat([mid]), ahead: [mid].concat(line.slice(index)) };
      }
      walked += length;
    }
    return { traveled: line.slice(), ahead: [line[line.length - 1]] };
  }

  function featuresAhead(features, line, lat, lon, windowM, corridorM) {
    var windowMeters = windowM == null ? WINDOW_M : windowM;
    var corridor = corridorM == null ? CORRIDOR_M : corridorM;
    if (!line || line.length < 2) return [];
    var user = projectAlong(line, lat, lon);
    return (features || []).filter(function (feature) {
      if (feature == null || feature.lat == null || feature.lon == null) return false;
      var projected = projectAlong(line, feature.lat, feature.lon);
      if (projected.offM > corridor) return false;
      var ahead = projected.alongM - user.alongM;
      return ahead >= -PASSED_M && ahead <= windowMeters;
    }).map(function (feature) {
      var projected = projectAlong(line, feature.lat, feature.lon);
      var copy = {};
      Object.keys(feature).forEach(function (key) { copy[key] = feature[key]; });
      if (projected.lat != null && projected.lon != null) {
        copy.lat = projected.lat;
        copy.lon = projected.lon;
      }
      return copy;
    });
  }

  function featuresAlongRoute(features, line, corridorM) {
    var corridor = corridorM == null ? CORRIDOR_M : corridorM;
    if (!line || line.length < 2) return [];
    return (features || []).filter(function (feature) {
      if (feature == null || feature.lat == null || feature.lon == null) return false;
      return projectAlong(line, feature.lat, feature.lon).offM <= corridor;
    });
  }

  var CITY_CUES = [
    { id: "far", metres: 400 },
    { id: "near", metres: 100 },
    { id: "now", metres: 35 },
  ];
  var HIGHWAY_CUES = [
    { id: "far", metres: 2000 },
    { id: "near", metres: 500 },
    { id: "now", metres: 70 },
  ];
  var SLOW_CUES = [
    { id: "near", metres: 50 },
    { id: "now", metres: 15 },
  ];
  var SPEED_COOLDOWN_MS = 20000;

  function highwayMode(roadMode) {
    var mode = String(roadMode || "").toLowerCase();
    return mode === "highway" || mode === "motorway" || mode.indexOf("highway") !== -1;
  }

  function cueStepKey(maneuver) {
    var lat = maneuver.atLat == null ? 0 : Math.round(maneuver.atLat * 1000) / 1000;
    var lon = maneuver.atLon == null ? 0 : Math.round(maneuver.atLon * 1000) / 1000;
    return [maneuver.kind || "", lat, lon].join("|");
  }

  function verbFor(kind) {
    return {
      left: "turn left",
      right: "turn right",
      "slight-left": "bear left",
      "slight-right": "bear right",
      "sharp-left": "turn sharp left",
      "sharp-right": "turn sharp right",
      uturn: "make a U-turn",
      merge: "merge",
      roundabout: "enter the roundabout",
      exit: "take the exit",
      arrive: "arrive",
      walk: "walk",
      bus: "continue",
    }[kind] || "continue";
  }

  function metresWords(metres) {
    if (metres >= 1000 && metres % 1000 === 0) return (metres / 1000) + " kilometres";
    return metres + " metres";
  }

  function sentence(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return trimmed;
    return /[.!?]$/.test(trimmed) ? trimmed : trimmed + ".";
  }

  function cuePhrase(maneuver, cue) {
    var street = maneuver.street && maneuver.street !== "Unnamed road" ? maneuver.street : "";
    var kind = maneuver.kind;
    var onto = street ? " onto " + street : "";
    var at = street ? " at " + street : "";
    if (kind === "walk") {
      var place = street || "the stop";
      if (cue.id === "now") return sentence("Walk to " + place);
      return sentence("In " + metresWords(cue.metres) + ", walk to " + place);
    }
    if (cue.id === "now") {
      if (kind === "arrive") return sentence(street ? "You are arriving at " + street : "You are arriving");
      if (kind === "exit") return sentence(street ? "Take the exit onto " + street : "Take the exit");
      var spokenVerb = verbFor(kind);
      return sentence(spokenVerb.charAt(0).toUpperCase() + spokenVerb.slice(1) + onto);
    }
    var lead = "In " + metresWords(cue.metres) + ", ";
    if (kind === "arrive") return sentence(lead + "you will arrive" + at);
    if (kind === "exit") return sentence(lead + "take the exit" + onto);
    return sentence(lead + verbFor(kind) + onto);
  }

  function formatClock(date) {
    var hour = date.getHours();
    var minute = String(date.getMinutes()).padStart(2, "0");
    var suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return hour + ":" + minute + "\u00a0" + suffix;
  }

  function minutesIn(text) {
    var raw = String(text || "");
    var hr = raw.match(/(\d+)\s*hr/);
    var min = raw.match(/(\d+)\s*min/);
    if (!hr && !min) return null;
    return (hr ? Number(hr[1]) * 60 : 0) + (min ? Number(min[1]) : 0);
  }

  function tripMetricLine(arrival, minutes, distance, unit) {
    var clock = arrival || "—";
    var mins = minutes == null || minutes === "" ? "—" : String(minutes);
    var tail = mins === "Now" ? "" : " min";
    var dist = distance == null || distance === "" ? "—" : String(distance);
    var measure = unit || "km";
    return clock + "\u2003" + mins + tail + "\u2003" + dist + "\u00a0" + measure;
  }

  function planMetricLine(durationText, distanceKm, nowMs) {
    var minutes = minutesIn(durationText);
    var when = nowMs == null ? Date.now() : nowMs;
    var clock = minutes == null ? "—" : formatClock(new Date(when + minutes * 60000));
    var duration = durationText || "—";
    var distance = distanceKm == null || distanceKm === "" ? "—" : String(distanceKm) + "\u00a0km";
    return clock + "\u2003" + duration + "\u2003" + distance;
  }

  var FEMALE_VOICES = ["samantha", "allison", "ava", "susan", "zoe", "nicky", "serena", "kate", "martha", "moira", "karen", "tessa", "fiona", "victoria", "stephanie", "veena", "raveena", "sangeeta", "kathy", "flo", "sandy", "shelley"];
  var MALE_VOICES = ["alex", "daniel", "evan", "nathan", "oliver", "aaron", "arthur", "gordon", "tom", "rishi", "lee", "fred", "reed"];
  var NOVELTY_VOICES = ["zarvox", "trinoids", "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "hysterical", "jester", "organ", "superstar", "whisper", "wobble", "good news", "pipe organ", "junior", "ralph", "grandma", "grandpa", "eddy"];

  function voiceName(voice) {
    return String((voice && (voice.name || voice.identifier || voice.voiceURI)) || "");
  }

  function voiceLang(voice) {
    return String((voice && (voice.language || voice.lang)) || "").toLowerCase();
  }

  function qualityRank(voice) {
    var quality = String((voice && voice.quality) || "").toLowerCase();
    var name = voiceName(voice).toLowerCase();
    if (quality === "premium" || name.indexOf("premium") !== -1) return 2;
    if (quality === "enhanced" || name.indexOf("enhanced") !== -1) return 1;
    return 0;
  }

  function noveltyVoice(voice) {
    var name = voiceName(voice).toLowerCase();
    return NOVELTY_VOICES.some(function (item) { return name.indexOf(item) !== -1; });
  }

  function namedVoice(voice, names) {
    var tokens = voiceName(voice).toLowerCase().split(/[^a-z]+/);
    return names.some(function (item) { return tokens.indexOf(item) !== -1; });
  }

  function scoreVoice(voice) {
    var lang = voiceLang(voice);
    var score = qualityRank(voice) * 100;
    if (lang.indexOf("en-ca") === 0) score += 40;
    else if (lang.indexOf("en-us") === 0) score += 30;
    else if (lang.indexOf("en-gb") === 0) score += 24;
    else if (lang.indexOf("en-au") === 0) score += 18;
    else if (lang.indexOf("en") === 0) score += 8;
    return score;
  }

  function pickSpokenVoice(voices, gender) {
    var want = gender === "male" ? MALE_VOICES : FEMALE_VOICES;
    var english = (voices || []).filter(function (voice) {
      return voiceLang(voice).indexOf("en") === 0 && !noveltyVoice(voice);
    });
    var pool = english.filter(function (voice) { return namedVoice(voice, want); });
    if (!pool.length) return null;
    pool.sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
    return pool[0];
  }

  function voiceCue(maneuver, roadMode, spoken, travelMode) {
    if (!maneuver || !maneuver.kind || maneuver.kind === "straight") return null;
    var slow = travelMode === "walk" || travelMode === "cycle";
    var cues = slow ? SLOW_CUES : (highwayMode(roadMode) ? HIGHWAY_CUES : CITY_CUES);
    var chosen = null;
    cues.forEach(function (cue) {
      if (maneuver.distanceM <= cue.metres && (!chosen || cue.metres < chosen.metres)) chosen = cue;
    });
    if (!chosen) return null;
    var step = cueStepKey(maneuver);
    var flags = spoken || {};
    var tighter = false;
    cues.forEach(function (cue) {
      if (cue.metres < chosen.metres && flags[step + "|" + cue.id]) tighter = true;
    });
    if (tighter || flags[step + "|" + chosen.id]) return null;
    var mark = [];
    cues.forEach(function (cue) {
      if (cue.metres >= chosen.metres) mark.push(step + "|" + cue.id);
    });
    return { key: step + "|" + chosen.id, phrase: cuePhrase(maneuver, chosen), mark: mark };
  }

  function signAlert(signs, spoken, nowMs, lastAt, cooldownMs) {
    var wait = cooldownMs == null ? 8000 : cooldownMs;
    if (lastAt && nowMs - lastAt < wait) return null;
    var flags = spoken || {};
    var found = null;
    (signs || []).some(function (sign) {
      if (!sign || sign.lat == null || sign.lon == null) return false;
      if (sign.kind !== "stop" && sign.kind !== "stop-all" && sign.kind !== "signal") return false;
      var key = sign.kind + "|" + Number(sign.lat).toFixed(4) + "|" + Number(sign.lon).toFixed(4);
      if (flags[key]) return false;
      var phrase = sign.kind === "signal"
        ? "Traffic light ahead"
        : sign.kind === "stop-all"
          ? "All-way stop ahead"
          : "Stop sign ahead";
      found = { key: key, phrase: phrase };
      return true;
    });
    return found;
  }

  function speedAlert(warning, state, nowMs) {
    var current = state || { spoken: false, at: 0 };
    var spokenFlag = !!current.spoken;
    var at = current.at || 0;
    if (warning === "red") {
      if (spokenFlag || (at && nowMs - at < SPEED_COOLDOWN_MS)) {
        return { speak: false, state: { spoken: true, at: at || nowMs } };
      }
      return { speak: true, phrase: "You are over the speed limit.", state: { spoken: true, at: nowMs } };
    }
    if (spokenFlag && nowMs - at < SPEED_COOLDOWN_MS) {
      return { speak: false, state: { spoken: true, at: at } };
    }
    return { speak: false, state: { spoken: false, at: at } };
  }

  return {
    WINDOW_M: WINDOW_M,
    CORRIDOR_M: CORRIDOR_M,
    PASSED_M: PASSED_M,
    ARRIVE_M: ARRIVE_M,
    THEN_M: THEN_M,
    SNAP_M: SNAP_M,
    haversineM: haversineM,
    maneuverKind: maneuverKind,
    roadLabel: roadLabel,
    streetFromStep: streetFromStep,
    projectAlong: projectAlong,
    matchAlong: matchAlong,
    cutLine: cutLine,
    smoothBearing: smoothBearing,
    navZoom: navZoom,
    upcomingManeuvers: upcomingManeuvers,
    featuresAhead: featuresAhead,
    featuresAlongRoute: featuresAlongRoute,
    voiceCue: voiceCue,
    signAlert: signAlert,
    speedAlert: speedAlert,
    tripMetricLine: tripMetricLine,
    planMetricLine: planMetricLine,
    pickSpokenVoice: pickSpokenVoice,
  };
});
