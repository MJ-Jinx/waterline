# Waterline — instructions for the coding agent

You are reproducing or extending the **Waterline** site design. Read `BUILD-SPEC.md` first; it is
the source of truth. `standalone/` is a working reference implementation with no build step —
open `standalone/index.html` in a browser and it runs.

## What this product is

A privacy-preserving check on Korean **jeonse** deposit safety, built on Midnight Network. A tenant
learns whether a building's senior deposits sit below its appraisal limit, without the registry
disclosing the total, the lease count, or anyone's amount.

## Non-negotiables

Do not "improve" any of these. Each one exists because breaking it breaks the product's argument.

1. **Never render an exact water level.** The page does not know the real total. The water surface
   is always a hatched band of fixed height (36 units in the 372-unit viewBox) with dashed edges.
   A precise surface would be either a lie or a disclosure. If you find yourself drawing a single
   horizontal line for the water, stop.
2. **No wallet UI.** No connect button, address, balance, seed phrase or network switcher anywhere.
3. **Verdict colours are reserved for verdicts.** `--wl-safe` / `--wl-caution` / `--wl-danger` never
   appear on a button, link or decoration. Interactive elements use `--wl-cobalt` / `--wl-navy`.
4. **"Not registered" is not "safe."** Say so explicitly in the copy.
5. **The registry console is labelled a simulation** with a hazard-striped banner.
6. **The attack page's refusal copy is exact.** The failure happens on the landlord's own machine,
   before any proof exists. Nothing was submitted and nothing was rejected. Do not rewrite this as
   "the network rejected it" — that is false, and it is the claim the page exists to make.
7. **Light ground, not dark.** Korean institutional products (정부24, 홈택스, the banks) are light.
   A dark ground reads as crypto-startup, which is what this must not look like.
8. **English only.** The market is Korean; the interface is English by decision.

## Conventions

- **One typeface.** IBM Plex Sans for everything, IBM Plex Mono for hashes, blocks, byte counts and
  currency. No serif.
- **Tracking.** Mixed-case headings set tight (−0.03em and beyond). All-caps — verdicts, labels —
  pull back to −0.012em. Caps never take display tracking.
- **Vanilla everything.** The reference is plain HTML/CSS/JS with no dependencies. If you introduce
  a framework, keep `tokens/tokens.css` as the single source of colour and geometry.
- **Semantic elements.** Real `<button>`, `<a href>`, `<input>` + `<label>`. Never `role`/`onClick`
  on a `div`.
- **Mobile-first.** A broker shows `/check` on a phone at a signing table. It must work one-handed:
  44px minimum touch targets, 52px inputs, `font-size: 16px` minimum on inputs (smaller triggers
  iOS zoom-on-focus).
- **SVG gotchas.** Unique `<defs>` ids per instance, and literal hex in presentation attributes —
  CSS custom properties are not reliable in `fill=` / `stroke=`.

## Speed budgets

- `/check` is a **pure read** — a GraphQL query for a verdict already written to the ledger. No
  prover keys, no WASM, no wallet. It must feel instant. Do not add a spinner where none is needed.
- `/registry` and `/attack` **prove**, which takes 2–5s. They get real, named progress states, not a
  generic spinner. The proving step is the most interesting thing the system does; show it.

## Demo data

All of it is invented and clearly fictional. Never substitute a real Korean address, and never a
district tied to a real jeonse-fraud case. Real preprod values can replace the placeholders — the
shapes are what matter. See §8 of `BUILD-SPEC.md`.

## Where things live

| Path | What |
|---|---|
| `BUILD-SPEC.md` | full specification — colour, type, geometry, per-page behaviour, data |
| `tokens/tokens.css` | design tokens as CSS custom properties |
| `tokens/tokens.json` | the same, machine-readable, plus figure geometry and timings |
| `standalone/` | working reference site, no build step |
| `standalone/assets/app.js` | `waterlineSVG()` plus the three page controllers |
| `reference/` | original canvas artboards (`.dc.html`) — layout and copy source of truth, not runnable |

## If you are asked to change the colour system

Keep the reasoning in §2 of `BUILD-SPEC.md` intact, especially the note on why red still means
danger here: on the KRX red means *up*, but this is safety signage, where Korean practice follows
KOSHA and ISO 7010. If the palette changes, that note must be re-derived, not deleted.
