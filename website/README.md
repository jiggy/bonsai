# Bonsai website

The landing page is a self-contained static site in `public/`. It uses native HTML, CSS, and JavaScript, local OpenRunde fonts, and a local decorative landscape. The entire walkthrough and three other code widgets use a scoped dark theme; the page stays light.

## Build and check

From the repository root:

```sh
bun run website:build
bun run website:check
```

Serve the generated `_site/` directory with a static HTTP server to preview it. The build has no dependency installation or bundler step. It copies public files and sets canonical/social metadata. Asset URLs stay relative to work at both `/bonsai/` and `/`.

The default deployment URL is `https://jiggy.github.io/bonsai/`. Export `SITE_URL` before both build and check to override it for local validation. The Actions workflow uses the URL returned by GitHub Pages, including a custom domain when configured.

## GitHub Pages

In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Merge the website PR into `main`; the **Website** workflow builds, checks, uploads, and deploys `_site/`. It also supports a manual run on `main`. Pull requests run the build and checks without publishing.

The `github-pages` environment may require approval according to repository settings. The deployment job alone receives `pages: write` and `id-token: write`, and it runs no code from the checkout. No personal access token or deployment secret is needed.

The repository homepage names `bonsai.jig.md`, but this change does not configure DNS or claim that domain is live. To use it, configure and verify the custom domain in GitHub Pages settings and point its DNS to GitHub Pages. The next deployment will use that configured URL automatically.

## Content and assets

The walkthrough is an interactive illustration of the checkout example, not a browser execution of Bonsai. Update claims against the current README and design notes. Preserve keyboard tabs, shared demo state, copy controls, and reduced-motion behavior.

OpenRunde's SIL Open Font License is included in `public/assets/fonts/OpenRunde-LICENSE.txt`. The generated lavender landscape is decorative. The pruning and principle illustrations are native SVG embedded in the page. Keep fonts and imagery local; the page needs no runtime API, analytics, or third-party scripts.

The README banner (`public/assets/readme-banner.png`, 1500×500) and social card (`public/assets/social-card.png`, 1200×630) share the landing page's light lavender landscape and headline. Open Graph and Twitter cards both use the social PNG, with explicit dimensions, type, and alternative text. The build rewrites both image URLs for the configured site; the checker verifies the metadata and PNG dimensions. The new filename distinguishes it from the retired social image in sharing caches.

Artwork references and generation prompts are kept in [`brand/`](brand/README.md). They are authoring materials and stay outside the deployed artifact. Exported PNGs are committed, so neither image generation nor image-processing dependencies run during builds.
