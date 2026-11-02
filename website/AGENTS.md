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
- Keep copyable setup commands aligned with the README's project quickstart and the distribution users can actually obtain. Until the next npm release is verified from a fresh cache, use the tested explicit GitHub package source; a GitHub merge does not update npm tags. Disclose the preview's default-branch, cache, and dependency-range behavior; keep the frozen checkout alternative in the README. Stop the initial copyable flow after `init`, then explain connecting real behavior before `check`.
- Dark styling belongs only inside `.code-window` widgets. Preserve the light page, muted lavender palette, accessibility, and reduced-motion behavior.
- Include asset licenses. Publish only the public artifact, not source instructions or development tools.

## Work Guidance

Keep dependencies and build logic small. The page uses native HTML, CSS, and JavaScript.

## Verification

Run `bun run website:build` then `bun run website:check`; the checker also compares copyable setup commands with the README. Review visual changes at desktop and mobile widths when a browser is available.

## Child DOX Index

None. This file owns the full subtree.
