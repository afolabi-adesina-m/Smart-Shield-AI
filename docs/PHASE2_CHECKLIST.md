# Phase 2 pitch checklist

What a hosted Smart-Shield product still needs after the capstone demo. None of these are done to a production standard. The demo stays free, keyless for maps, and open unless someone turns sign-in on.

Use this list in a pitch. Check an item only when it is true in the deployed environment, not only in a branch.

- [ ] **Always-on hosting.** The Render free service sleeps when idle. The first request can take about a minute. A pitch host needs a paid instance, or another host, that stays awake.
- [ ] **API authentication.** Sign-in exists behind `AUTH_REQUIRED` and is off by default (see [SECURITY.md](../SECURITY.md)). Production needs real accounts, not one env-seeded admin, and tokens that are not stored in `localStorage`.
- [ ] **API rate limits.** Upstream map services throttle us. The app does not yet cap general traffic. Login failures are limited only when sign-in is on.
- [ ] **Toronto corridor evaluation.** Score a fixed set of Toronto trips (highway, arterial, and a night run) and publish the sheet: route, posted limit source, score, and whether the engine was locked.
- [ ] **ASE camera validation.** Compare the camera layer with a current City of Toronto Automated Speed Enforcement list. Record misses and extras. The demo disclaimer stays until that check is written down.
- [ ] **Latency SLOs.** Write targets for health, directions, and score (for example health under 1 second, directions under 5 seconds, score under 8 seconds, excluding a cold start) and measure them from outside the host.
- [ ] **GPS privacy one-pager.** Say what location leaves the phone, how long the server keeps it (today: it does not store trips), and how a fleet customer would export or delete a trace.
- [ ] **Dependabot (or equivalent) on.** Dependency alerts are not configured. Turn them on for Python and the Expo app, and fix or record each alert.
- [ ] **Security headers.** Add a content security policy, `X-Content-Type-Options`, a referrer policy, and HSTS on the HTTPS host. The demo does not send that set today.
- [ ] **Logging and monitoring.** Keep request logs without query strings that contain coordinates longer than a debug session. Alert when health checks fail or the engine stays locked after a deploy.

Related: [SECURITY.md](../SECURITY.md), [PROTECTING_IP.md](../PROTECTING_IP.md).
