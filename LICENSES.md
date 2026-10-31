# Bonsai license scope and notices

Bonsai is source available under [Bread License 1.0](LICENSE.md), with the
exceptions below. The completed adoption notice identifies its Licensor,
authorized seller, effective source, and official releases.
[PRICING.md](PRICING.md) contains Bonsai's own dated company schedule.

## Component scope

| Material | Applicable terms |
| --- | --- |
| Original Bonsai source, documentation, configuration, examples, first-party `skills/bonsai/`, website, and artwork | [Bread License 1.0](LICENSE.md), subject to the stated exceptions and generated-output permission |
| GitHub Action adapter: exactly `action.yml` and `.github/action/run.ts` | [MIT](LICENSE-ACTION); this exception takes effect with the Bonsai adoption |
| Bonsai presentation material embedded in generated HTML reports, and starter material emitted by `bonsai init` | The [additional generated-output permission](LICENSE.md#additional-permission-for-generated-outputs), alongside applicable third-party terms |
| OpenRunde fonts in `src/report/assets/fonts/`, including encoded copies | SIL Open Font License 1.1; retained in [the report font notice](src/report/assets/fonts/OpenRunde-LICENSE.txt) and embedded in generated reports |
| OpenRunde fonts in the website | SIL Open Font License 1.1; retained in the [website font notice](https://github.com/jiggy/bonsai/blob/main/website/public/assets/fonts/OpenRunde-LICENSE.txt) |
| Installed external development skills in `.agents/skills/` | Their original terms and notices, outside Bonsai's Bread adoption; `cli-style` declares CC BY-NC-ND 4.0 with its stated Agent Execution & MIT Code Grant |
| External dependencies, including Bun, tsrs, TypeScript, Gherkin, and ignore | Their respective upstream terms; installed dependency notices remain authoritative |

The MIT adapter installs dependencies and invokes the separately licensed
Bonsai checker from the same source checkout. Its imported
`src/snapshot-schema.ts` and the rest of `src/` remain under their applicable
Bonsai terms. MIT permission for the adapter is not unrestricted permission
for the checker or its dependencies.

The installed development skills are not included in the npm package. Their
[repository copies](https://github.com/jiggy/bonsai/tree/main/.agents/skills)
retain any upstream notices; this inventory does not supply missing rights or
replace those terms. Any other specifically identified third-party material
also retains its existing license.

## Distribution and source

Include this scope notice, [LICENSE.md](LICENSE.md), [PRICING.md](PRICING.md),
[LICENSE-ACTION](LICENSE-ACTION), and applicable third-party notices when
distributing Bonsai. Identify the official release and any material changes;
direct purchases to the channel in the adoption notice. Recipients receive
their own applicable permissions, not the distributor's company license.

The npm package supplies preferred-form TypeScript and report assets in
`src/`, the first-party skill, documentation, examples, and these notices.
The matching GitHub release supplies a downloadable source archive tied to its
recorded full commit. Supply a source copy recipients can keep, including
modifications and instructions; do not rely only on a temporary upstream link.

Bun runs the TypeScript sources directly. From the corresponding release
source checkout, install with `bun install --frozen-lockfile --ignore-scripts`
and invoke `bun src/cli.ts --help`; no Bonsai compilation is required.
The [README](README.md#try-it) and [native installation guide](docs/native-prototype.md)
describe runtime requirements and supported prebuilt dependency platforms.
Keep the matching `package.json` and `bun.lock` with the source.

Independent application code keeps its own terms. Use of the checker requires
applicable Bread permission; distributing generated reports and starter
material follows the additional permission expressly stated in the adoption.
These notices grant no general right to claim endorsement or use trademarks.

