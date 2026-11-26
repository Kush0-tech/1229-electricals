# 1229 Electricals website

Cloudflare Worker + static assets + KV (content) + R2 (uploads). Free-plan friendly.

## Deploy (one time, ~2 minutes)
```
npm install
npx wrangler login
npm run deploy
```
`npm run deploy` publishes the site and sets the admin password and session secret from `.dev.vars`.
You get a link like https://1229-electricals.<your-subdomain>.workers.dev
Admin: /admin  (password is in `.dev.vars` → ADMIN_PASSWORD; change it there and run `npm run deploy` again)

Note: R2 must be enabled once in the Cloudflare dashboard (R2 → Get started). The free tier includes 10 GB.

## Local preview
`npm run dev` then open http://localhost:8787

## Changing the hero video
`bash tools/make-frames.sh new-video.mp4` then deploy. Edit chapter timing (`at`, 0-1) in `public/content.default.json`.
