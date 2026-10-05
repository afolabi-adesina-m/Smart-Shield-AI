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

`SMART_SHIELD_CORS_ORIGINS` defaults to `*`, so a page on another origin can call the API. Set it to a comma-separated list of origins if you want to narrow that.

Upstream map services are rate-limited by those providers. This app caches some of those answers and slows repeat calls so a demo does not hammer them. The app itself does not throttle general API traffic. Sign-in, when enabled, allows a short run of failed attempts per address and then waits. A real rate limit for the whole API is still future work.

## Accounts

There is no authentication on the default deploy. There are no user profiles, and fleet notes and hazard reports stay on the phone or in the browser.

The optional sign-in is one admin user from environment variables, a bcrypt hash, and a token signed by `AUTH_SECRET`. It is a reversible demo gate. It is not a production identity provider, it does not use a durable user database, and tokens are kept in browser storage or on-device app storage rather than an httpOnly cookie.

## Dependencies

Python and JavaScript dependencies are pinned loosely in `requirements.txt`, `demo/requirements-demo.txt`, and `mobile/package.json`. GitHub Dependabot is not enabled. Review alerts by hand until that is turned on.

## Penetration tests

Formal penetration tests, a threat model signed off by a security team, and a production hardening review are out of scope for this capstone. [docs/PHASE2_CHECKLIST.md](docs/PHASE2_CHECKLIST.md) is the list of what a later hosted version still needs.
