# Security

This is a student capstone demo, not a production service. The notes below describe what is true today.

## Public surface

The Flask demo is a public website when it is deployed (the class host is `https://smart-shield-ai.onrender.com`). The map, `/mobile`, and `/api/health` are reachable without an account. Maps, routes, and speed limits use keyless public services (OpenStreetMap, OSRM, Overpass, Photon, Transitous). A paid map key is not required.

`AUTH_REQUIRED` defaults to off. Scoring and navigation stay open so a teammate can demo without a password. When it is turned on, those routes ask for a sign-in token. `/api/health` stays public either way. Details are in the README section "Sign-in (optional)".

## Reporting

Report a problem by opening a [GitHub Issue](https://github.com/afolabi-adesina-m/Smart-Shield-AI/issues) on this repository, or by contacting the repository owner through GitHub. There is no private disclosure mailbox and no bug-bounty program.

## Secrets

`SMART_SHIELD_KEY` decrypts the scoring engine on the server. It belongs in the host's secret store (Render environment variables), never in git, a screenshot, or a chat log. `.env` files are gitignored. Do not commit `demo/.env`, `mobile/.env`, plaintext passwords, `ADMIN_PASSWORD`, or `AUTH_SECRET`.

The first admin password is hashed with bcrypt. Commit only the setup script (`demo/hash_password.py`), not a hash you generated for a real password, and not the password itself. How the engine key is created is in [PROTECTING_IP.md](PROTECTING_IP.md).

## CORS and rate limits

Browser calls are limited to `ALLOWED_ORIGINS`. When that is unset, the list is the Render site (`https://smart-shield-ai.onrender.com`) plus localhost and the usual Expo dev ports (5050, 5051, 8081, 19006). `SMART_SHIELD_CORS_ORIGINS` is the older name and is used only when `ALLOWED_ORIGINS` is empty. Set either one to `*` to opt back into an open policy. The Expo native app sends no `Origin` header, so this list does not block it.

The Flask process caps score, directions, road context, suggest, reverse, cameras, and the practice loop. Each of those routes allows `RATE_LIMIT_PER_MIN` requests per IP per minute (default 120). `/api/health` is not capped. A limit returns HTTP 429 and `{"error": "Too many requests. Wait a moment and try again."}`. Set `RATE_LIMIT_ENABLED=false` to turn the cap off. The counter is in memory on the one gunicorn worker. It is not a shared limiter across many servers. Sign-in, when enabled, still has its own short run of failed attempts per address.

Upstream map services have their own limits. This app caches some of those answers.

## Response headers

Every response sends `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, and a content security policy. The policy allows this site's scripts, Leaflet and MapLibre from unpkg, the Inter font from Google Fonts, OpenStreetMap tiles, OpenFreeMap vector tiles, and the public Overpass hosts the page already calls. Browsers ignore HSTS on plain HTTP, so a local `http://localhost` demo is unchanged.

## Request limits

`MAX_CONTENT_LENGTH` defaults to 1 MB. A larger body is HTTP 400 with a short JSON error. Suggest queries are capped at 120 characters, `custom_alert` at 280, and coordinates must be real latitudes and longitudes. A score request may include at most 8 routes and 25 waypoints. These checks reject the shape of the request. They do not change how a valid route is scored.

## Driving

While a drive or motorcycle trip is moving faster than 10 km/h, the From and To fields (and any text field in the report sheet) do not take typing. The screen says "Pull over to search". Voice, mute, and Exit stay available. "I'm a passenger" turns the lock off for that session. Walk, cycle, and transit are not locked. Reports are still one-tap categories. The server does not store them.

## Accounts

There is no authentication on the default deploy. There are no user profiles, and fleet notes and hazard reports stay on the phone or in the browser.

The optional sign-in is one admin user from environment variables, a bcrypt hash, and a token signed by `AUTH_SECRET`. It is a reversible demo gate. It is not a production identity provider, it does not use a durable user database, and tokens are kept in browser storage or on-device app storage rather than an httpOnly cookie.

## Dependencies

Python and JavaScript dependencies are pinned loosely in `requirements.txt`, `demo/requirements-demo.txt`, and `mobile/package.json`. `.github/dependabot.yml` asks GitHub for weekly updates of the demo's pip packages and the Expo app's npm packages. That file takes effect when it is on the default branch. It does not by itself upgrade anything. Review each alert. Do not run `npm audit fix --force`.

## Penetration tests

Formal penetration tests, a threat model signed off by a security team, and a production hardening review are out of scope for this capstone. [docs/PHASE2_CHECKLIST.md](docs/PHASE2_CHECKLIST.md) is the list of what a later hosted version still needs.
