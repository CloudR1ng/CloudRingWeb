# CloudRingWeb

CloudRing portfolio and personal workspace, built with React, TypeScript, Three.js and Anime.js.

Public site: https://cloudr1ng.github.io/CloudRingWeb/

## Development

```sh
npm ci
npm run dev
npm test
npm run build
```

The default deployment path is `/CloudRingWeb/`. GitHub Actions validates and builds the site before deploying to GitHub Pages.

## Personal workspace

Type `CloudRingLogin` on the public page to open sign-in. This shortcut does not bypass authentication. The private workspace requires a configured Supabase project, owner allowlist and TOTP MFA. Without that connection the sign-in page shows a setup notice. `#/demo` contains temporary sample data only.

Copy `.env.example` to `.env.local` for local settings. Use only the Supabase URL and browser publishable key in frontend configuration. Never include passwords or privileged keys in frontend variables. Optional `VITE_LOGIN_ALIAS` and `VITE_LOGIN_EMAIL` map a public login alias to an email address; both values are visible in the browser bundle.

Supabase migrations and notification function sources are under `supabase/`. Apply migrations in order and register the owner account before enabling personal data access. Remote authentication, server notifications and iPhone delivery require separate setup and verification.

Original personal documents, internal planning material and private backups are excluded from this public repository.
