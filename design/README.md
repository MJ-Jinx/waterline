# Waterline — design package

Everything needed to reproduce the Waterline site design.

## Quick start

```bash
# just open it
open standalone/index.html

# or serve it, if you want clean relative paths
cd standalone && python3 -m http.server 8080
```

No build step, no dependencies. One Google Fonts link for IBM Plex Sans + Mono.

## Reproducing the design with a coding agent

Point Claude Code (or any agent) at this folder. `CLAUDE.md` is picked up automatically and carries
the non-negotiables; `BUILD-SPEC.md` is the full specification.

A good opening prompt:

> Read BUILD-SPEC.md and CLAUDE.md, then rebuild this site as a Next.js app using the tokens in
> tokens/tokens.css. Keep every hard rule in §1 of the spec.

## What's here

| Path | What |
|---|---|
| `BUILD-SPEC.md` | The specification — colour, type, figure geometry, per-page behaviour, demo data, accessibility |
| `CLAUDE.md` | Agent instructions: the rules that must not be "improved" |
| `tokens/tokens.css` | Design tokens as CSS custom properties |
| `tokens/tokens.json` | The same, machine-readable, plus figure geometry and animation timings |
| `standalone/` | Working static site — six pages, responsive, interactive |
| `reference/` | The original canvas artboards (`.dc.html`) |

## The pages

| File | What it is |
|---|---|
| `index.html` | Landing — hero, the animated figure, three steps, evidence strip |
| `check.html` | The tenant check. Demo chips switch buildings; verdict, figure, facts and provenance all re-derive |
| `registry.html` | Simulated registry console with the live proving pipeline |
| `why-lying-fails.html` | Claim any total you like, then watch the certificate refuse to exist |
| `states.html` | The four states with no verdict: empty, loading, not registered, stale |
| `foundations.html` | The design system rendered — palette, type scale, components, the figure in all three bands |

## The one thing to understand before you change anything

The water surface is drawn as an **indeterminate band**, never a level. The page genuinely does not
know the building's senior-deposit total — only the registry does. Drawing a precise water level
would be either a lie or a disclosure.

That constraint is the product in one image: an indeterminate surface with a definite verdict.

## A note on `reference/`

Those `.dc.html` files come from the design canvas and use a component runtime (`<x-dc>`,
`<sc-for>`, `{{holes}}`). They will not render on their own. They are included as the source of
truth for layout and copy — build from `standalone/`, check against `reference/`.
