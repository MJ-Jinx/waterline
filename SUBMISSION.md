# Submission: Midnight Korea Hackathon 2026

Copy-paste answers for the submission portal. Everything here is also in
[`README.md`](README.md), which is what gets checked against it.

---

## Project name

```
Waterline · 워터라인
```

## One-line description

```
Prove a Korean 전세 (jeonse) property isn't over-leveraged — without revealing anyone's deposit.
```

## Repository

```
https://github.com/MJ-Jinx/waterline
```

Apache-2.0. README, contract, tests, deploy scripts and the front end are all in it.

## Live demo

```
https://mj-jinx.github.io/waterline/
```

No wallet, no extension, no signup, no testnet tokens. It is a link.

---

## Run instructions / demo flow

> **Judges: the fastest path is the link. Nothing to install.**
>
> **1.** Open **[/guide.html](https://mj-jinx.github.io/waterline/guide.html)**, a plain-language walkthrough of what to click and what each screen means.
>
> **2.** Open **[/demo.html](https://mj-jinx.github.io/waterline/demo.html)** and press **Run Full Demo**. It registers a building and computes **four real Plonk proofs in your own browser**, roughly 10–20 s each. About 18 MB of keys, SRS and WASM download on the first press. It narrates each step and what comes next, then hands you the certificate.
>
> **3.** In the box below it, type a deposit total the registry never committed to and press forge. The contract refuses it with `failed assert: Stale opening`, in your tab, before any proof exists. Then type the real total, **5.0**, and watch it be accepted: a check that refused every number would prove nothing, and exactly one figure passes.
>
> **4.** Press **Download the certificate**, or **Download the verification record**. Each is a self-contained page with a QR code, the verdict, the commitment and every proof that was built, stating on its face that the building was invented in your browser.
>
> **5.** Open **[/check.html](https://mj-jinx.github.io/waterline/check.html)** and press each of the three buttons marked **Live**. Three real certificates read off Midnight preprod, one per band.
>
> **6.** Scroll to **[the on-chain record](https://mj-jinx.github.io/waterline/check.html#onchain)**: every transaction the contract has ever been part of, each one openable in a public explorer we do not run.

### To clone and compile it yourself

**One thing will break the build if it is skipped: the compiler version.** Use `+0.31.1`. It emits
runtime 0.16.0, which is what the stable `midnight-js` 4.1.1 line pins. Newer compilers emit runtime
0.19.0 and fail at load with a version mismatch. **There is also no Windows build of the Compact
CLI.** Use WSL, macOS or Linux.

```bash
git clone https://github.com/MJ-Jinx/waterline && cd waterline
npm install
compact compile +0.31.1 contracts/waterline.compact build/waterline   # ~19s

npm test                 # 58 tests, no network needed
npm run verify:refusal   # the attack alone: watch the real circuit refuse to lie
```

`verify:refusal` is the shortest path to the core claim. It builds a building with two deposits
totalling ₩5.5억, confirms the honest verdict against a ₩6.0억 appraisal is **위험 DANGER**, then
forges an opening claiming ₩3.0억, the lie that would flip it to **안전 SAFE**, and asserts the
circuit throws. It runs in-process against the compiled circuit, so a failed assert surfaces exactly
as it does on a prover's machine.

To run the whole pipeline against live preprod yourself you need NIGHT registered for DUST generation
and a local proof server on `:6300`; [`README.md`](README.md#reproducing) has the five commands.

### What is already live

Contract [`e99711c0…3ac2`](https://explorer.preprod.midnight.network/contracts/e99711c00fbcb7ee9a12f81a75e151367bf7899cbda96a1c54c75393494f3ac2)
on **Midnight preprod**, holding three buildings with three different private ledgers and three
different published bands: DANGER at ₩6.0억, CAUTION at ₩7.0억, SAFE at ₩8.0억. Snapshotted at block
2,661,364; the site re-verifies every one of them against the live public indexer on each page load,
and says on screen whether it matched. Proved locally, fees paid from our own DUST, submitted straight
to the node. Every transaction is listed and linked at
[/check.html#onchain](https://mj-jinx.github.io/waterline/check.html#onchain) — 18 of them,
from the deploy onward, with each one attributed to a building by decoding the ledger state it
produced rather than by assertion.

---

## How Midnight is used

Waterline is not a public blockchain application with privacy bolted on afterwards. **The quantity
being computed is the quantity that must not be disclosed**, so the circuit is the product.

**The problem is a disclosure problem.** In a Korean 다가구주택, where one owner holds one title register for many
households, a prospective tenant cannot see how many other deposits already rank ahead of theirs.
That asymmetry is the primary mechanism of 전세사기 (jeonse fraud): 40,936 recognised victims to
August 2026. Korean law (주택임대차보호법 제3조의7) already *requires* landlords to disclose this at
signing, but both routes to compliance force full disclosure of tax arrears, credit standing and
every other tenant's deposit. That is why landlords refuse, and why refusing looks reasonable.

**A Compact circuit is a third route.** It satisfies the same statutory duty while disclosing one band
and nothing else.

### Three circuits, and what each keeps private

`contracts/waterline.compact`, compiled with Compact 0.31.1.

| Circuit | Never reaches the chain | Written to the ledger |
|---|---|---|
| **`openBuilding`** | registry secret key, opening salt | one opaque commitment |
| **`registerLease`** | the deposit amount, the running total, the lease count, both salts, registry secret key | the replacement commitment, and nothing else |
| **`issueCertificate`** | the total, the lease count, the salt, **and any 선순위 liens against the building** | appraised value, both thresholds, **the band**, and the commitment it was bound to |

Totals, lease counts, salts and liens arrive as **witnesses**: inputs to the proof, supplied by the
prover, that never touch the chain. Deposit amounts arrive as circuit *parameters*, which are equally
private: Compact requires an explicit `disclose()` before any value can reach the ledger, and
`deposit` never gets one.

**The privacy is therefore a compile-time property, not a matter of our carefulness.** We could not
leak a deposit by accident if we tried. Which makes it auditable, so here is the entire audit. The
contract contains exactly **14** `disclose()` calls, and nothing else can escape:

| # | Disclosed | What it is |
|---|---|---|
| 1 | `registryPubKey(registry_secret_key())` | a *hash* of the key, written once at construction so later writes can be checked against it |
| 2, 6, 9 | three `==` comparisons | the outcome of an assertion; one bit each, and all three must be `true` or the circuit refuses |
| 3, 5, 8 | `buildingId` | public by design; the tenant types it in |
| 4, 7 | `persistentCommit(…)` | the opaque commitments, the only per-building state on chain |
| 10, 11 | `load <= safeCap`, `load <= cautionCap` | **the band.** Two bits, and the entire intended disclosure |
| 12–14 | `appraisedValue`, `safePct`, `cautionPct` | public inputs; a verdict is meaningless without the threshold it was measured against |

Not one of the 14 is a deposit amount, a running total, or a lease count.

**And we will state the residual leak rather than let a judge find it.** Rows 10 and 11 are derived
from the total, so the band does *bracket* it. "SAFE at ₩8.0억" tells you the deposits total at most
₩5.6억. That is unavoidable: it is the answer the tenant asked for. What it never gives is the figure,
the number of leases, or any individual deposit. This is why the site draws the water surface as a
**hatched band and never a level**. The page does not know the total, so a precise surface
would be either a lie or a disclosure.

Note that `issueCertificate` is **not** gated on the registry's secret key. It takes no
key at all. It does not need one. The commitment check below can only be satisfied by someone able to
open the current commitment, and only the registry can do that. **The ability to issue a certificate
just is the ability to open the commitment**, which is the property the attack demo
exercises.

### The Midnight primitive doing the work

`persistentCommit`, chained. `registerLease` can only write a new commitment if the prover can **open
the previous one**:

```compact
assert(disclose(prevCommit == buildingState.lookup(bid)), "Stale opening");
```

This is what the whole project turns on. A bare commitment would be useless, because the registry could pick
whatever opening flattered it. A Merkle membership proof would be no better: it proves *inclusion*,
not *exhaustiveness*, so a dishonest registry would simply omit leases. Welding each write to the
previous one makes understatement **impossible rather than merely detectable**. To understate the
total today, the registry would have had to understate it at every prior step, and each tenant's own
registration is already notched into the chain.

The clearest analogy is the medieval tally stick: a debt notched into a stick, which is then split
lengthwise, one half to each party. Neither half can be altered afterwards, because it has to still
match the other.

**Where the refusal happens.** A landlord who understates the total fails at
**circuit-execution time, on their own machine**, before a proof exists and before anything is
submitted. There is no transaction for the chain to reject, because no satisfying witness exists.
That is *stronger* than a chain-level rejection: the landlord cannot even produce a fraudulent
certificate to show a tenant, which is the actual threat. But it would be wrong to describe it as
"the chain rejected it," so we don't.

### Selective disclosure, demonstrated rather than asserted

One certificate carries a band, two public thresholds, and the commitment it was bound to. From that
a tenant learns whether the building is safe, and **whether that answer is still current.** If the
certificate's commitment differs from the live one, the books moved since issuance and the certificate
is stale. Freshness without disclosing the lease count or any amount.

A test asserts the privacy claim directly: **two buildings with different books that land in the same
band produce certificates identical except for the opaque commitment.** The three live entries show
the other half: three different sets of books, three different bands, and in every case the ledger
records a band and not one won of any deposit.

### Why Midnight specifically, rather than a general chain with a privacy layer

Korea's PIPA amendment took force on **11 September 2026**, the month this was built, raising
penalties for serious violations to **10% of total sales** and making the CEO finally accountable.
The incumbent approach to this problem pools data from four agencies into a single store. **PIPA
restricts the join; zero-knowledge proofs compute the answer without the join.**

Midnight's witness/ledger split is exactly that shape: private state that never leaves the prover, a
public ledger carrying only the result, and a compiler that will not let the two mix by accident.

### What we built on top of Midnight's SDK

- **A wallet-free read path.** `issueCertificate` publishes the band to the ledger, so the tenant page
  is a GraphQL query against the public indexer. No wallet, no extension, no WASM, no prover keys, no
  tokens. A test enforces that the tenant pages stay that way.
- **Real client-side proving.** `demo.html` runs the same three circuits in a Web Worker via
  `@midnight-ntwrk/zkir-v2`, bridging circuit results to the prover with
  `proofDataIntoSerializedPreimage` and a `KeyMaterialProvider` that serves the prover keys and the
  Plonk SRS from the site itself. Four real proofs, in the tab, on a static host with no backend,
  measured at 18.3s, 23.9s, 16.7s and 11.8s against the deployed site, each producing a 4,501-byte
  proof. `node test/browser-demo.mjs` drives that in Chromium and asserts it, and pointing it at
  `BASE=https://mj-jinx.github.io/waterline` checks the *deployed* page rather than a local copy.
- **A self-funded write path.** Hold NIGHT, register it for DUST generation, prove locally, then
  `balanceUnboundTransaction` → `signRecipe` → `finalizeRecipe` → submit. Fee balancing appends a
  `DustSpend` to an already-proven transaction, so no third party ever sees a witness.

### Where the trust boundary sits

A proving request carries the proof preimage. For this contract the witnesses include the registry
secret key, the deposit total, the lease count and the salt: **every value the project exists to
protect.** Sending that to a third-party prover would leak the very thing being protected, so
proving is local by default.

That also bounds the browser demo, and the page says so. To issue a certificate at all you must open
the current commitment, which takes the total, the lease count and the salt. So **whoever proves must
hold the landlord's private books, and a tenant can never prove.** The demo tab therefore plays the
*registry*, over books it invents on the spot, with a key it generates and discards. It proves the
circuits work and the refusal is real. It cannot prove anything about a real building, and does not
claim to.

Trust is **reduced, not eliminated.** It reduces to "the registry inserts leases correctly", the same
trust already placed in the 주민센터, minus the cross-agency data pool. The registry here is a demo
console standing in for a government office: the ZK layer is real and runs on-chain, the issuer is
not, and wiring a real government registry is not a hackathon deliverable.

---

## Demo video

Not submitted (optional). The live demo installs nothing and proves in the browser in under a minute,
which is a stronger artefact than a recording of it.
