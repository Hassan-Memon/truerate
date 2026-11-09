# Security posture

What is enforced on this repository, how to verify it, and what is knowingly
still missing. Audited 2026-11-06, updated 2026-11-07.

The application itself has a small attack surface by design:

- **No runtime dependencies.** `package.json` has no `dependencies` and no
  `devDependencies`, so there is no npm supply chain to poison. Everything is
  Node built-ins plus the Web platform.
- **No user-controlled outbound URLs.** Every upstream host in
  `src/core/sources.js` and `src/core/official.js` is a hardcoded literal, so
  there is no SSRF primitive.
- **No credentials in the request path.** The service calls only free, keyless
  upstreams.
- **Inputs are shape-checked.** Currency codes are validated with
  `/^[A-Z]{3}$/` before use; `days` is clamped to 7–3660; `amount` must be a
  finite non-negative number.
- **Static file serving is confined.** `src/server.js` normalises the joined path
  and rejects anything that escapes `public/`.

## Repository controls

| Control | State | Why it matters |
|---|---|---|
| Secret scanning | on | Detects a committed credential anywhere in history |
| Push protection | on | **Blocks** the push before the secret lands |
| Private vulnerability reporting | on | Gives researchers a private channel |
| Dependabot alerts | on | Flags vulnerable dependencies |
| Dependabot security updates | on | Opens the fix PR automatically |
| Branch protection on `master` | on | No force-push, no deletion, PR + green CI required |
| Required status checks | `test (22)`, `test (24)` | A broken or unreviewed commit cannot merge |
| Admin bypass | off | The rules bind the maintainer too: every change to `master` arrives by pull request |
| `GITHUB_TOKEN` scope | `contents: read` | A compromised workflow step cannot write to the repo |
| Action pinning | SHA, enforced repo-wide | A moved tag cannot silently run new code |
| Allowed actions | selected | Only `actions/*` and `cloudflare/wrangler-action` may run |
| Wiki / Projects | off | Unused surfaces, closed |
| Branch auto-delete on merge | on | Keeps stale branches from lingering |
| `CODEOWNERS` | on | Workflow and deploy changes need the maintainer |
| Security headers | on | CSP, HSTS, `nosniff`, `frame-ancestors 'none'` |

### Verify it yourself

```bash
gh api repos/Hassan-Memon/truerate --jq '.security_and_analysis'
gh api repos/Hassan-Memon/truerate/branches/master/protection --jq '.required_status_checks.contexts'
gh api repos/Hassan-Memon/truerate/branches/master/protection/enforce_admins --jq '.enabled'
gh api repos/Hassan-Memon/truerate/actions/permissions
curl -sI https://<deployed-host>/ | grep -i -E 'content-security|strict-transport|x-content-type'
```

## CI/CD

Both workflows declare `permissions: contents: read` and check out with
`persist-credentials: false`, so the checkout token is not left in
`.git/config` for later steps.

Every third-party action is pinned to a full commit SHA with the release in a
trailing comment. Dependabot's `github-actions` ecosystem rewrites both the SHA
and the comment, so pins stay current without drifting.

`deploy.yml` runs only when the repository variable `DEPLOY_ENABLED` is `true`.
It has been on since 2026-11-07, so every merge to `master` deploys once the
tests pass. To pause deploys without touching the token:

```bash
gh variable set DEPLOY_ENABLED --body false
```

The review gate sits in front of the merge: `master` accepts no direct pushes,
so nothing reaches production unreviewed. **Required reviewers** on the
`production` environment (Settings → Environments) would add a second,
deploy-time approval; that is not set today.

### Cloudflare API token

Scope the token to the minimum that can deploy, and nothing more:

- Permission: **Workers Scripts → Edit** on that one account
- Account resources: **the single account only**, not "All accounts"
- No zone, DNS, or Workers KV permissions

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are stored as repository
Actions secrets. Environment secrets on `production` are the stricter option,
because only jobs that reference the environment can read them:

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
gh secret set CLOUDFLARE_ACCOUNT_ID --env production
```

Rotate the token if it is ever pasted into a terminal transcript, an issue, or a
chat.

## Application headers

`src/core/headers.js` is the single source of truth, applied by both
`src/server.js` (Node) and `src/worker.js` (Workers), so the two runtimes cannot
drift apart.

`wrangler.toml` sets `run_worker_first = true` under `[assets]`. Without it,
Workers Assets answers static requests itself and never invokes the Worker — the
headers then reach `/api/*` but not the HTML, which is exactly what happened on
the first deploy and was caught by checking the live response.

- `content-security-policy` — `default-src 'self'`; `script-src 'self'` with no
  inline and no eval, which is the directive that actually stops XSS. `style-src`
  also allows inline, because the range strip and the chart position elements with
  `style="left:…"` at render time; CSS-only exfiltration is neutralised by
  `img-src 'self'` and `connect-src 'self'`. `connect-src 'self'` means the
  browser only ever talks to our own `/api`.
- `strict-transport-security` — one year, `includeSubDomains`. Harmless over
  plain HTTP (browsers ignore it there), so local development is unaffected.
- `x-content-type-options: nosniff`, `x-frame-options: DENY` plus
  `frame-ancestors 'none'`, `referrer-policy`, `permissions-policy`,
  `cross-origin-opener-policy`.

`upgrade-insecure-requests` is deliberately left out: it breaks `http://localhost`
during development and adds nothing where HSTS already applies.

## Known gaps

1. **No rate limiting.** `/api/*` is cached at the edge but not throttled. A
   single client can still force repeated upstream fetches. Fix with a
   Cloudflare Rate Limiting rule on `/api/*` (free plan allows one), or a Durable
   Object counter.
2. **No request-size or concurrency budget.** The Worker's 10 ms CPU limit is
   the de facto brake, but it is not an explicit control.
3. **CORS is `*`.** Intentional — this is a public read-only API with no
   credentials and no cookies. If write endpoints are ever added, this must be
   narrowed to an allowlist.
4. **`innerHTML` in `public/app.js`.** Most interpolations pass through `esc()`,
   but the pattern is one missing call away from XSS. The data is our own API
   output, so the practical risk is low. Migrating to `textContent` and
   `<template>` is the durable fix.
5. **Secret scanning validity checks and non-provider patterns** are off; both
   need GitHub Secret Protection licensing.
6. **No commit signing.** Low value for a single-maintainer public repo; revisit
   if contributors are added.
7. **The deploy token is broader than the minimum.** It was created from
   Cloudflare's "Edit Cloudflare Workers" template, which also grants KV, R2 and
   Workers Routes on every zone. Replace it with a token that holds only
   Workers Scripts → Edit on this account, then rotate.

## If something does leak

1. Revoke the credential at the issuer first — rotating beats rewriting history.
2. `gh secret delete <NAME>` and re-set it.
3. Assume the value is public: audit the provider's logs for use.
4. Rewriting git history does **not** remove the object from GitHub; only
   deleting the repository does. Treat any exposed secret as burned.
