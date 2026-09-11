# DevLog

DevLog runs entirely on Cloudflare at runtime: a Hono Worker serves the React
application and API, image objects are stored in the `devlog-screenshots` R2
bucket, and structured data lives in Neon PostgreSQL through Drizzle.

## Commands

```bash
pnpm dev
pnpm db:migrate
pnpm build
pnpm worker:deploy
```

`pnpm dev` starts Vite and the Worker together. Vite proxies `/api` and
`/health` to the Worker, while production is same-origin static assets served
by the Worker.

## Neon setup

Set the Worker secrets before deploying. `ALLOWED_USERS` is a comma-separated
list of GitHub logins and/or verified GitHub email addresses. Anyone not on
the list receives a permission-denied response after GitHub sign-in.

```bash
cd apps/backend
wrangler secret put DATABASE_URL
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put ALLOWED_USERS
```
