# Phase 2 pitch checklist

What a hosted Smart-Shield product still needs after the capstone demo. The demo stays free, keyless for maps, and open unless someone turns sign-in on.

Use the checkboxes in a pitch. Check an item only when it is true on the deployed host, not only in a branch.

## In the demo code

These are in the Flask app and the phone/web UI. They are not a production security program.

- Per-IP rate limit on score, directions, road context, suggest, reverse, cameras, and the practice loop. Default 120 requests per route per minute. `/api/health` is exempt. In-memory, one worker. `RATE_LIMIT_PER_MIN`, `RATE_LIMIT_ENABLED`.
- CORS defaults to the Render origin plus localhost and Expo dev ports. `ALLOWED_ORIGINS`. Native Expo has no Origin header and is not blocked. `*` is an explicit opt-in to the old open policy.
- Security headers on every response: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and a content security policy that allows the map scripts and tiles the pages already use.
- Request caps: body size (`MAX_CONTENT_LENGTH`, default 1 MB), suggest text, `custom_alert`, coordinates, route count, and waypoint count. Bad input is HTTP 400. Scoring of a valid body is unchanged.
- `.github/dependabot.yml` for weekly pip (demo) and npm (mobile) updates, once that file is on the default branch.
- While driving or riding a motorcycle above 10 km/h, From/To and report text fields do not accept typing. "Pull over to search" and "I'm a passenger" are the two ways through. Mute and Exit stay on.

## Still open for a hosted product

- [ ] **Always-on hosting.** The Render free service sleeps when idle. The first request can take about a minute. A pitch host needs a paid instance, or another host, that stays awake.
- [ ] **API authentication.** Sign-in exists behind `AUTH_REQUIRED` and is off by default (see [SECURITY.md](../SECURITY.md)). Production needs real accounts, not one env-seeded admin, and tokens that are not stored in `localStorage`.
- [ ] **API rate limits on a shared store.** The demo cap above is per process. A hosted product still needs a limiter that survives more than one worker and is watched when it starts returning 429.
- [ ] **Toronto corridor evaluation.** Score a fixed set of Toronto trips (highway, arterial, and a night run) and publish the sheet: route, posted limit source, score, and whether the engine was locked.
- [ ] **ASE camera validation.** Compare the camera layer with a current City of Toronto Automated Speed Enforcement list. Record misses and extras. The demo disclaimer stays until that check is written down.
- [ ] **Latency SLOs.** Write targets for health, directions, and score (for example health under 1 second, directions under 5 seconds, score under 8 seconds, excluding a cold start) and measure them from outside the host.
- [ ] **GPS privacy one-pager.** Say what location leaves the phone, how long the server keeps it (today: it does not store trips), and how a fleet customer would export or delete a trace.
- [ ] **Dependabot alerts reviewed.** The config file is in the repo. After it is on the default branch, fix or record each alert. Do not use `npm audit fix --force`.
- [ ] **Security headers confirmed on the live HTTPS host.** The app sends them. Confirm the live response headers after the next deploy, and adjust the content security policy if a new tile host is added.
- [ ] **Logging and monitoring.** Keep request logs without query strings that contain coordinates longer than a debug session. Alert when health checks fail or the engine stays locked after a deploy.

Related: [SECURITY.md](../SECURITY.md), [PROTECTING_IP.md](../PROTECTING_IP.md).
