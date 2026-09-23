# Waterline: Build Specification

Version 1.0 · 18 September 2026
Everything needed to reproduce this site design from scratch.

---

## 0. What this is

**Waterline** is a privacy-preserving check on Korean **jeonse** (전세) deposit safety, built on
Midnight Network. A tenant can find out whether a building's *senior deposits* sit below its
appraisal limit, without the registry disclosing the total, the lease count, or anyone's amount.

The whole product is one image: a building cross-section with a load line, and a water surface that
is deliberately drawn as an **indeterminate band** rather than a level.

### The architectural fact that shapes the UI

The tenant cannot prove anything; they do not hold the private state. Only the registry knows the
total, the count and the salt. **The registry side proves; the tenant side reads.**

That split has a large practical payoff:

| | Tenant page | Registry / landlord page |
|---|---|---|
| Role | verifies / reads | proves |
| Keys | verifier keys only (~2.1 KB) | prover keys (~5.1 MB) |
| Work | GraphQL read of a verdict already on the ledger | witness assembly + proving, 2–5s |
| Budget | must feel instant (<1s) | needs real progress states |
| WASM | none | yes |

`issueCertificate` writes the verdict to the ledger (a `certificates` map on the contract), so the
tenant page is a pure read, and a test enforces that it stays one.

One page breaks that rule on purpose. `demo.html` computes four real proofs in the visitor's browser,
so it does ship prover keys and WASM, about 18 MB on a first run, and nothing loads until the visitor
presses the button. Everything else on the site is a read.

### Four pages

| Route | File | Audience |
|---|---|---|
| `/` | `index.html` | a judge with 15 seconds |
| `/check` | `check.html` | a tenant or 공인중개사 at the signing table, on a phone |
| `/registry` | `registry.html` | a judge who wants to see the machinery |
| `/why-lying-fails` | `why-lying-fails.html` | the sceptic; **this is the page that wins** |
| `/guide` | `guide.html` | a non-technical reader who wants the whole thing in plain words |
| `/demo` | `demo.html` | a judge who wants to watch real proofs computed in their own browser |
| `/deck` | `deck.html` | thirteen slides, arrow keys to move, P to print |

Two documentation pages ship alongside: `states.html` (the no-verdict states) and
`foundations.html` (the design system rendered).

---

## 1. Hard rules

These are not preferences. Breaking any one of them breaks the product's argument.

1. **Never render an exact water level.** The page genuinely does not know the total. A precise
   surface would be either a lie or a disclosure. The surface is always a hatched band of fixed
   height with dashed edges. *The honest thing to draw is an indeterminate surface with a definite
   verdict.*
2. **No wallet UI anywhere.** No connect button, no address, no balance, no seed phrase, no network
   switcher. If a mockup has a connect button, something is wrong.
3. **The three verdict colours are reserved for verdicts.** Buttons, links and focus rings use
   cobalt. A green button must never be mistakable for a SAFE verdict.
4. **"Not registered" is not "safe."** The copy must say so explicitly. It is the absence of a
   verdict, not a passing one.
5. **The registry console is framed as a simulation,** with a hazard-striped banner. Nobody may
   mistake it for a government system.
6. **The attack page's copy stays honest.** The failure happens on the landlord's own machine,
   *before any proof exists*. Nothing was submitted and nothing was rejected. Do not rewrite this
   into "the network rejected it". That would be false, and a judge will catch it.
7. **Mobile-first.** A broker shows this on a phone at the signing table. `/check` must work
   one-handed.
8. **Calm and institutional, not crypto.** This competes with a government app. No neon, no gradient
   washes, no glassmorphism.

---

## 2. Colour

Korean institutional digital products, 정부24, 홈택스, the major banks, are overwhelmingly
**light**: white/ivory ground, navy text, blue accent. A dark ground reads as crypto-startup, which
is what this project must not look like.

The semantic accents come from **obangsaek** (오방색) and the **dancheong** (단청) palette found on
temple eaves: blue-green 청, ochre 황, vermilion 적. They are earthy and desaturated, so they read as
one system rather than as traffic-light web colours.

### Ground and surfaces

| Token | Hex | Use |
|---|---|---|
| `--wl-ground` | `#F5F3EE` | page background (hanji ivory) |
| `--wl-surface` | `#FFFFFF` | cards, header, inputs |
| `--wl-surface-sunken` | `#EFEBE2` | table heads, "not disclosed" wells |
| `--wl-surface-muted` | `#FBFAF7` | building interior, disabled fields |

### Lines

| Token | Hex | Use |
|---|---|---|
| `--wl-line` | `#E2DCD0` | default hairline |
| `--wl-line-strong` | `#C3BCAE` | input and secondary-button borders |
| `--wl-line-soft` | `#DCD6C9` | floor lines inside the building |
| `--wl-line-quiet` | `#DDD6C8` | section rules |
| `--wl-bracket` | `#B9B2A6` | appraisal bracket on the diagram |

### Ink

| Token | Hex | Contrast on ivory | Use |
|---|---|---|---|
| `--wl-ink` | `#14243A` | 14.2:1 | primary text |
| `--wl-ink-body` | `#33455C` | 9.1:1 | body copy |
| `--wl-ink-muted` | `#5A6B7E` | 5.6:1 | secondary / helper |
| `--wl-ink-label` | `#6B7A8C` | 4.6:1 | uppercase labels, mono keys |
| `--wl-ink-dim` | `#7D8B9B` | 3.6:1 | **≥18.66px bold or ≥24px only** |
| `--wl-ink-disabled` | `#8C8B82` | — | idle pipeline step titles |
| `--wl-ink-idle` | `#A9A294` | — | idle dots, em-dash placeholders |

### Chrome and accents

| Token | Hex | Meaning |
|---|---|---|
| `--wl-navy` | `#0F2A4A` | authority — wordmark, primary button |
| `--wl-cobalt` | `#1B5FAA` | 청 — links, focus, progress |
| `--wl-safe` | `#1F7A5C` | 청 blue-green — SAFE |
| `--wl-caution` | `#A8701A` | 황 ochre — CAUTION |
| `--wl-caution-ink` | `#8A5A11` | ochre text on a tinted banner |
| `--wl-danger` | `#C0352B` | 적 vermilion — DANGER, and the load line |

### The red question: expect it, answer it

On the KRX, **red means up and blue means down**: the inverse of Western markets. Someone will
raise this.

The answer: that convention governs **price direction**, not safety. This is safety signage, where
Korean practice follows KOSHA and ISO 7010, red prohibits, yellow warns, green is the safe
condition. A Korean user sees that mapping on every construction site and in every building lobby.

One consequence in the drawing: when the band is vermilion (DANGER), the Plimsoll mark switches from
vermilion to navy, so red never sits on red.

---

## 3. Type

One family. Korean institutional products do not set headings in serif, and a serif made the page
read editorial rather than official.

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
```

- **`IBM Plex Sans`**: everything
- **`IBM Plex Mono`**: hashes, block heights, byte counts, timestamps, currency figures

Same superfamily, so numerals sit naturally against the text.

### Scale

| Role | Size | Weight | Line-height | Tracking |
|---|---|---|---|---|
| Display XL (desktop hero) | `clamp(38px, 7vw, 68px)` | 700 | 1.04 | **−0.038em** |
| Display L (attack h1) | `clamp(31px, 5.2vw, 52px)` | 700 | 1.10 | **−0.034em** |
| Display M (mobile hero) | `clamp(34px, 6vw, 42px)` | 700 | 1.10 | **−0.032em** |
| Verdict | `clamp(48px, 9vw, 84px)` | 700 | 1.0 | **−0.012em** |
| Verdict small | `clamp(30px, 6vw, 44px)` | 700 | 1.0 | −0.012em |
| Title | 20px | 600 | 1.4 | −0.012em |
| Subtitle | 16px | 600 | 1.45 | 0 |
| Lede | `clamp(16px, 2vw, 20px)` | 400 | 1.75 | 0 |
| Body | 15px | 400 | 1.75 | 0 |
| Body small | 13px | 400 | 1.7 | 0 |
| Label | 11px | 700 | — | **+0.08em**, uppercase |
| Mono | 11–17px | 400/500 | — | +0.02em |

**The tracking rule.** Headings in mixed case are set tight (−0.03em and beyond) so a grotesk reads
as a deliberate display setting rather than large body text. All-caps, the verdicts and the labels
— pull the tracking back to −0.012em or go positive. Caps never take display tracking.

---

## 4. Geometry

| Token | Value |
|---|---|
| `--wl-radius-control` | 6px — buttons, inputs |
| `--wl-radius-card` | 8px — cards, panels |
| `--wl-radius-frame` | 20px — documentation device frames |
| `--wl-radius-pill` | 999px — chips |
| `--wl-container` | 1180px |
| `--wl-container-wide` | 1320px — registry console only |
| `--wl-gutter` | 20px mobile / 32px ≥900px |
| `--wl-touch` | 44px minimum touch target |
| `--wl-control-h` | 52px — inputs |

Buttons are 56px tall. Text inputs are `font-size: 16px` minimum, anything smaller triggers
zoom-on-focus in iOS Safari, which is disastrous at a signing table.

Breakpoint: **900px**. Layout is flex-wrap with `flex-basis` minimums rather than a grid framework,
so pages reflow with no media queries beyond the gutter change.

---

## 5. The signature visual

`viewBox="0 0 240 372"`, drawn by `waterlineSVG(band, opts)` in `assets/app.js`.

### Fixed geometry

```
building rect      x=48  y=28  w=144  h=308      (base edge y = 336)
floor lines        y = 79, 130, 181, 232, 283    across x 48 → 192
threshold          0.70  →  y = 336 − 0.70×308 = 120.4 → 120
load line          x 22 → 212, stroke-width 2
Plimsoll disc      cx=48  cy=120  r=13, fill none, stroke-width 2
appraisal bracket  M 30 28 L 22 28 L 22 336 L 30 336
band height        36 units — ALWAYS, in every state
```

Helper: `yAt(fraction) = 336 − fraction × 308`.

### Band position per verdict

| Verdict | Band top `y` | Water rect | Reads as |
|---|---|---|---|
| SAFE | 173 (≈47%) | `y=173 h=162` | clear below the line |
| CAUTION | 102 | `y=102 h=233` | straddling the line |
| DANGER | 53 (≈86%) | `y=53 h=282` | clear above the line |

Water height = `336 − 1 − bandTop`.

### Rendering the surface

Three layers, in this order:

1. **Body**: `<rect>` from band top to base, filled with a vertical `linearGradient` in the verdict
   hue: stop `0%` opacity `0`, `55%` opacity `0.26`, `100%` opacity `0.22`.
2. **Band**: `<rect>` 36 units tall at the band top, filled with a 45°-rotated hatch `<pattern>`
   (7×7 user units, one `<line>` `x1=0 y1=0 x2=0 y2=7`, stroke-width 2.4) at `opacity 0.45`.
3. **Edges**: two `<line>`s at the band top and bottom, `stroke-dasharray="3 4"`, `opacity 0.7`.

There is **no solid surface line**. That absence is the whole point.

### Caption

Always two lines: the band position, then the disclaimer.

> Level: below the line
> *exact depth not disclosed*

### Implementation notes

- Give every instance **unique `<defs>` ids** (`wl-hatch-1`, `wl-grad-1`, …). Duplicated ids across
  instances on one page collapse into whichever rendered first.
- Use **literal hex** inside SVG presentation attributes. CSS custom properties are not reliable in
  `fill=` / `stroke=` attributes; use `style="fill: var(--x)"` or a CSS rule if you need tokens.
- Label placement dodges the band: SAFE `y = 111`, CAUTION `y = bandTop − 12`, DANGER `y = 141`.

---

## 6. Motion

Two budgets, and they are different on purpose.

**`/check` must feel instant.** It is a pure ledger read. No spinner theatre.

**`/registry` and `/attack` take 2–5 seconds to prove,** so they need real progress states that name
what is happening. A generic spinner would hide the single most interesting fact about the system.

| Animation | Spec |
|---|---|
| Water rise (landing, once on load) | `translateY(46px) → 0`, `opacity 0 → 1`, 1500ms, `cubic-bezier(.16,.84,.26,1)`, delay 260ms |
| Load line fade | `opacity 0 → 1`, 700ms ease-out, delay 1500ms — settles *over* the risen water |
| Refusal shake | `translateX` ±5px → ±3px, 420ms ease-in-out |
| Progress meter | `width` transition 600ms ease |

All of it sits behind `@media (prefers-reduced-motion: reduce)`.

---

## 7. Page specifications

### 7.1 `/`: Landing

Hero (h1 + lede + two CTAs) beside the animated figure. Then three "how it works" cards, then the
attack teaser, then the evidence strip.

**Copy, verbatim:**

- H1, *Is your deposit above the line?*
- Lede, *Find out whether a building's senior deposits sit below its appraisal limit, **without
  the registry disclosing the total**, the count, or a single amount.*
- Sub, *Jeonse tenants hand over years of savings against a building whose other debts they cannot
  see. Waterline lets them see one thing, whether the building is loaded past its line, and
  nothing more.*
- CTAs, **Check a building** (primary) · **Why a landlord can’t lie** (secondary)

**Three steps:**

1. *The registry commits the total*, A hash over the total, the lease count and a salt goes on
   chain. The amounts themselves never do.
2. *The circuit compares load to limit*, The comparison happens inside the proof. Only someone who
   can open the commitment can produce one.
3. *The tenant sees one band*, SAFE / CAUTION / DANGER chips.

**Evidence strip** (mono, in the footer): `CONTRACT 0200c4f1…7d3b` · `BLOCK 3,417,882` ·
`NETWORK Midnight preprod · verified` · *View in the indexer →* · *Demo buildings are fictional*

### 7.2 `/check`: Tenant check

Three columns at desktop (verdict + facts | figure | receipt), stacking to one on mobile.

**Behaviour.** Three demo chips, pre-seeded so a judge never has to type. Selecting one re-derives
everything: verdict word and colour, band geometry, appraised value, limit, commitment hash, block,
timestamp, and the proof note in the footer.

**The privacy receipt is as visually prominent as the verdict.** Two columns:

| Disclosed to you | Never disclosed |
|---|---|
| Verdict band | Individual deposits |
| Appraised value | Total senior deposits |
| Threshold percentage | Number of prior leases |
| Commitment hash & block | The salt |
| Timestamp | |

**Provenance footer.** Truncated commitment (click to copy), block height, issue timestamp, indexer
link, and: *Proof verified by the Midnight network at block N. This page only reads the ledger.*

**States to build:** empty · loading · verdict ×3 · building not registered · certificate stale.
See `states.html`.

### 7.3 `/registry`: Registry console (simulated)

Hazard-striped simulation banner above the header, *Simulation of a registry office console. Not a
government system, and not connected to one.*

Left column: building ID + deposit + **Register lease**, then the private ledger panel, labelled
*This panel exists only on the registry's machine.*

Right column: the live pipeline, the before/after commitment pair, the proof payload counter, and
"what the tenant will see".

**Pipeline steps and timing** (ms from click):

| # | Step | Detail | Starts at | Takes |
|---|---|---|---|---|
| 1 | Building the contract call | `5,168 B · registerLease()` | 0 | 1100 |
| 2 | Proving, locally | `2–5s · 12,904 constraints · 5.1 MB key` | 1100 | 3100 |
| 3 | Fee sponsored | `0.0142 tDUST · paid by the registry` | 4200 | 1000 |
| 4 | Submitted to the node | `14,432 B · preprod` | 5200 | 1400 |
| 5 | Landed in a block | `block 3,418,120 · final` | 6600 | 2400 |
| — | *complete* | | 9000 | |

Step 2 is deliberately the long one.

**Each step owns its duration, and the schedule is derived from those durations.**
Do not hand-write the offset table: an offset table that stops at the last step
leaves that step reading `running` forever, with no ✓ and no way to tell whether
it is still working. The run needs a terminal state *past* the final step.

State is `0` idle, `1…N` that step in flight, `N+1` complete. Treating `step === N`
as complete is the bug; it fires while the last step is still running.

**Meter width = completed steps, `(step − 1) / N × 100`%**: clamped to 0–100. It
reads 80% while the final step is in flight and 100% only once the run finishes.
A meter that hits 100% during the last step is claiming work that has not happened.

**Progress readouts.** The in-flight step pulses (`wl-pulse` on its dot) and shows
`elapsed / ~estimate`; waiting steps show the estimate alone; finished steps show
what they took. A total sits under the meter. The pulse is behind
`prefers-reduced-motion`; the text readouts stay, since they are information rather
than decoration. The pipeline list is `aria-live="polite"`, so the clocks carry
`aria-hidden="true"`: a counter ticking ten times a second would flood a screen
reader.

**On completion:** total `₩275,000,000 → ₩355,000,000`, count `3 → 4`, commitment
`0x9f4c8b21…a1e8 → 0x7a2be6f0…9d14`, block `3,418,120`, tenant verdict `SAFE`. Byte counter shows
`14,432` from step 2 onward.

### 7.4 `/why-lying-fails`: Why a landlord can’t lie

**Preamble:** *The real total is hidden. So why can't the landlord just lie?*

Building: Cheongnim Town, Block 3 · Bucheon · appraised `₩285,000,000` · limit at 70%
`₩199,500,000` · commitment `0xc082f5d9…30b7` at block `3,416,944`.

**Slider:** range `100 … 285` (millions KRW), step `5`, **default `165`**: pre-set to a figure that
flips DANGER into SAFE, so the stakes are visible before anyone touches it.

**Claimed-verdict function:**

```js
claim > 199.5        → DANGER
claim > 199.5 × 0.9  → CAUTION   // 179.55
otherwise            → SAFE
```

Honest verdict and the lie's verdict sit side by side.

**Flow:** `Generate certificate` → `proving` for **2600ms** → `refused`. Moving the slider resets to
`idle`.

**Refusal:** `REFUSED` / `Stale opening`, then the tally-stick diagram, two halves of a split stick
whose notches no longer align (committed notches at x = 52, 100, 148, 196, 244; claimed at
52, 96, 140, 184, 228; dashed connectors mark the drift). Then:

> A split tally only fits its own other half. The half already on chain was cut with the real total,
> the real count and the salt. A half cut from a different number does not line up, and the circuit
> will not build a proof across a gap.

And the callout that must not be softened:

> This fails on the **landlord's own machine**, before any proof exists. Nothing was submitted and
> nothing was rejected, because **no valid proof can be constructed**.

---

## 8. Demo data

Invented, internally consistent, and **clearly fictional**. Never use a real address, and never a
district tied to a real jeonse-fraud case.

| Chip | ID | Place | Appraised | Limit 70% | Band | Commitment | Block | Issued |
|---|---|---|---|---|---|---|---|---|
| Seocho | `SEO-2019-0412` | Seocho-gu, Seoul · Serim Heights, Block 102 | ₩1,050,000,000 | ₩735,000,000 | safe | `0x9f4c8b21…a1e8` | 3,417,882 | 18 Sep 2026, 11:04 KST |
| Mapo | `MPO-2017-0883` | Mapo-gu, Seoul · Eunha Villa, Block A | ₩620,000,000 | ₩434,000,000 | caution | `0x3d71ae04…5c92` | 3,417,601 | 18 Sep 2026, 09:47 KST |
| Bucheon | `BCN-2014-1176` | Bucheon, Gyeonggi · Cheongnim Town, Block 3 | ₩285,000,000 | ₩199,500,000 | danger | `0xc082f5d9…30b7` | 3,416,944 | 17 Sep 2026, 18:22 KST |

Other fixed values: contract `0200c4f1…7d3b` · salt `0x5e19…c47a` · private ledger
`₩120,000,000 / ₩95,000,000 / ₩60,000,000` · new lease `₩80,000,000` · unregistered demo ID
`GNG-2021-0009` · stale-certificate pair `3,417,882` vs latest `3,418,120`.

Swap these for real preprod values before the demo if you have them, the shapes are what matter.

---

## 9. Accessibility

- Real `<button>`, `<a href>`, `<input>` + `<label>` throughout. Never `role` / `onClick` on a
  `div`: Tab skips it.
- Body text meets 4.5:1; `--wl-ink-dim` is reserved for ≥18.66px bold or ≥24px.
- Every figure carries `role="img"` and an `aria-label` describing the band's position relative to
  the line, so the verdict survives without sight of the drawing.
- Verdict and result regions are `aria-live="polite"`.
- Demo chips are toggle buttons with `aria-pressed`.
- Verdict is never carried by colour alone, the word is always present.
- `:focus-visible` gets a 2px cobalt outline at 2px offset.
- All motion respects `prefers-reduced-motion`.

---

## 10. Contents of this package

```
waterline-design-spec/
├── BUILD-SPEC.md          ← this file
├── CLAUDE.md              ← instructions for the coding agent
├── README.md
├── tokens/
│   ├── tokens.json        ← machine-readable design tokens
│   └── tokens.css         ← the same as CSS custom properties
└── reference/             ← the original canvas artboards (.dc.html)

The working site is not inside this folder. It lives at ../site/ in the repo root:

site/
├── index.html
├── guide.html
├── check.html
├── demo.html              ← the only page that proves; ships keys and WASM
├── why-lying-fails.html
├── registry.html
├── deck.html
├── states.html
├── foundations.html
└── assets/
    ├── styles.css
    ├── app.js
    └── qr.js
```

`site/` has no build step and no dependencies beyond a Google Fonts link, with one exception:
`demo.html` loads a Vite bundle, because it proves. Open `site/index.html` in a browser and it runs.

`reference/` holds the artboards as authored on the design canvas. They use a component runtime
(`<x-dc>`, `<sc-for>`, `{{holes}}`) and will not render on their own. They are there as the source of
truth for layout and copy, not as runnable pages.
