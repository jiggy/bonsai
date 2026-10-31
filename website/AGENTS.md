# Purpose

Own the Bonsai landing page and its GitHub Pages artifact.

## Ownership

`public/` contains the complete static page and licensed assets, including the README banner and social card. `brand/` holds illustration references and generation prompts; it is not published. `build.mjs` copies public files to `_site/` and sets deployment URL metadata. `check.mjs` validates that artifact. Publishing is owned by `.github/workflows/pages.yml`.

## Local Contracts

- Keep browser assets relative so the page works at a repository subpath or a custom domain.
- Keep the page self-contained, with no runtime service, secrets, analytics, or third-party scripts.
- Use the deployed URL from `SITE_URL` for canonical and social metadata; the default is `https://jiggy.github.io/bonsai/`.
- Keep Open Graph and Twitter image URLs aligned with the 1200×630 `assets/social-card.png`. The root README uses the coordinated 1500×500 `assets/readme-banner.png`.
- The walkthrough illustrates the CLI; it does not run Bonsai in the browser. Preserve product claims against the repository documentation.
- Dark styling belongs only inside `.code-window` widgets. Preserve the light page, muted lavender palette, accessibility, and reduced-motion behavior.
- Include asset licenses. Publish only the public artifact, not source instructions or development tools.
- Keep the source-available Bread summary and license/pricing links visible near setup. Root `LICENSE.md`, `LICENSES.md`, and `PRICING.md` own the terms; the page grants no additional permissions.

## Work Guidance

Keep dependencies and build logic small. The page uses native HTML, CSS, and JavaScript.

## Verification

Run `bun run website:build` then `bun run website:check`. Review visual changes at desktop and mobile widths when a browser is available.

## Child DOX Index

None. This file owns the full subtree.
