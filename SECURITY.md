# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

- Use GitHub's private advisory form: **Security → Advisories → Report a vulnerability**
  (<https://github.com/Hassan-Memon/truerate/security/advisories/new>)
- Or email **hassanmemon@users.noreply.github.com**

You can expect an acknowledgement within **72 hours** and a fix or a written
explanation within **14 days**. Please include the URL, the request, and what you
observed; a `curl` command is ideal.

## Supported versions

Only `master` is supported. The site is deployed continuously from it, so fixes
land on `master` and nowhere else.

## In scope

- The HTTP API (`/api/*`) and the static site
- The Cloudflare Worker entry (`src/worker.js`) and the Node entry (`src/server.js`)
- Anything that lets a request read or write data it should not
- Reflected/stored XSS, SSRF through upstream fetching, path traversal in the
  static file server, cache poisoning of `/api/*`
- Supply chain: the workflows in `.github/workflows/`

## Out of scope

- **Wrong exchange rates.** TrueRate aggregates third-party feeds; a bad number
  is a data bug, not a vulnerability. Open a normal issue.
- Missing hardening headers on endpoints that return no HTML.
- Denial of service through ordinary load; there is no rate limiter yet (see
  [`docs/security.md`](docs/security.md#known-gaps)).
- Reports from automated scanners with no demonstrated impact.

## Our commitments

- No API keys, tokens, or personal data are stored in this repository.
- The service collects no analytics and sets no cookies.
- Secret scanning with push protection is enabled, so a committed credential is
  blocked before it reaches `master`.
