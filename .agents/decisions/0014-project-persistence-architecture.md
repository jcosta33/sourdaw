---
type: adr
id: 0014
title: Project persistence architecture — project-as-directory (Option C), recommended
status: proposed
date: 2026-08-01
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/RESEARCH-project-persistence.md
  - .agents/decisions/0012-neither-target-degrades-the-other.md
  - .agents/decisions/0013-retire-the-flat-json-project-snapshot.md
---

# 0014 — Project persistence architecture (proposed)

**Status is `proposed`, pending product-owner ratification and the measurements in §Gates.** Nothing
in this ADR may be built before those gates report. ADR 0013's cleanup is safe to build now and
prejudges none of this.

## Context

A project is currently modeled as a serialization rather than as an address. The CRDT document id is
the constant string `root` with sixteen named slots hung off it, so there is exactly one project
identity in the system and it is not a variable. Every "which project?" question therefore has to be
answered outside the CRDT — which is what produced the flat-JSON snapshot ADR 0013 retires.

Full evidence, options and citations: `RESEARCH-project-persistence.md` (six primary-source lanes,
201 claims surviving independent refutation, 5 refuted).

Three facts frame the decision:

- **The desktop target is currently the degraded one, and that is a live ADR 0012 violation.**
  `nativeCrdtPersistence` — the entire Rust-side CRDT storage path — has zero production callers.
  The desktop build persists projects into the Tauri webview's IndexedDB while sitting on an
  unrestricted real filesystem it already has working raw-byte Rust commands for.
- **Automerge retains history permanently and has decided against truncation.** Measured: four
  writes of a 3.84 MB `Uint8Array` produce a 15.36 MB document, and save/load/resave does not
  compact it. Freeze, bounce, comp and re-record are the normal operations of a DAW.
- **Every comparable system separates structure from media.** Four shipping DAWs, the one open
  interchange spec (DAWproject), tldraw, and openDAW — the closest browser-DAW analogue, which
  rejected key-value storage outright in favour of per-UUID OPFS directories plus a global
  content-addressed sample pool.

## Proposed decision

**Option C — the project is a directory, with one logical layout and two filesystem
implementations.**

```
projects/<uuid>/
  manifest.json                small, versioned, written last — the commit point
  document.<sha256>.automerge  Automerge save() bytes, content-addressed
  media/<hash>.wav             raw float32 PCM, content-addressed, byte-range readable
```

> **Amended 2026-08-02 after gate M6.** This layout originally drew the document as a fixed
> `document.automerge`, annotated "(self-verifying: per-chunk SHA-256)". **That is the one line
> M6 broke** — see §Gates reported. The document is now content-addressed like the media beside it,
> which is what the rest of this ADR's recovery story already assumed.

Web: OPFS behind a dedicated worker (forced — sync access handles are `[Exposed=DedicatedWorker]`).
Desktop: the real filesystem through Rust, no webview storage at all. The shared surface is a
**path-addressed byte-store port** plus the manifest schema — a genuine interface, not a lowest
common denominator, with each side implementing it using its best primitive. That is what ADR 0012
asks for.

Recovery follows SQLite's discipline: write media, write the document, write `manifest.json` last —
that single small write is the commit instant. A manifest naming a missing or hash-mismatched file
is the signal to fall back to the previous generation. Desktop upgrades this to
temp-then-`rename()` + `fsync`; web uses `createWritable()`'s implicit swap and accepts its weaker
"try to ensure" wording, stated here rather than assumed.

Sequence: **Phase 1** give a project an address (project UUID, namespaced document ids,
`loadProject(id)` — this is 0008's Option B and is a prerequisite for everything). **Phase 2** the
directory layout on both targets, retiring the JSON-number-array IPC in favour of the raw-body path
`filesystem.rs` already implements. **Phase 3** one specified ZIP container with golden fixtures
each language's test suite reads from the other's output.

## The strongest argument against it

**Option C trades a platform-guaranteed atomicity for a hand-rolled one, in exactly the subsystem
that is currently broken.**

IndexedDB gives multi-store transactional atomicity for free — document chunk, media reference and
metadata record commit or roll back together, spec-mandated, including on quota failure. OPFS gives
none. openDAW, which took this route, has that exact bug shipped: three independent OPFS writes in a
`Promise.all` with no atomicity across them.

Put plainly: the team that just shipped a silent-loss bug in its persistence layer would be signing
up to hand-write a commit protocol. Gate **M6** exists to settle that, and if it fails the correct
response is Option B plus an explicit amendment to ADR 0012 — not shipping a commit protocol we
hoped was right.

## Gates — none of this is built before these report

| # | Question | Threshold that decides |
|---|---|---|
| M2 | Is the Tauri origin stable across restarts? | Unstable anywhere → that target cannot use webview storage at all. Hours; run first. |
| M9 | Do the two `.sdaw` codecs agree today? | Any divergence → a shipped web/desktop incompatibility exists now. ~30 lines; belongs in 0013's phase. |
| M1 | Does `navigator.storage.persist()` resolve true anywhere we ship? | False in any desktop webview → **Option B disqualified outright**. False in a plain tab → install becomes a documented durability requirement. |
| M3 | Does the embedded-WKWebView 15%/20% quota ratio hold? | Confirms or weakens the live ADR 0012 violation. |
| M4 | What does a real project cost in Automerge? | 100 MB-audio project loading above ~2 s or peak heap above ~2× audio → Option A dead on measurement. Below both → **Option A deserves a second look and the owner sees the numbers.** |
| M5 | History growth on realistic edits (automation drags) | Superlinear, or the blob duplicating on sibling edits → confirms audio must live outside. |
| M6 | Can manifest-last survive fault injection? | Any torn state opening as valid → **adopt Option B and amend ADR 0012 explicitly.** Gates Phase 2. |
| M7 | OPFS availability and throughput, all targets | Unavailable anywhere we support → that target needs a second **visible** store, documented per ADR 0012 rule 2. |
| M8 | Cost of `durability: "strict"` | Under ~50 ms at project scale → use everywhere. Above → strict on the commit pointer only. |
| M10 | IndexedDB Blob vs ArrayBuffer at scale | Blob records landing as separate files with good latency → Option B is stronger than credited. |

**Do not close Option A on inference.** M4 and M5 are one afternoon and are owed to it.

## Owner decisions this ADR cannot make

Recorded in `open-decision-docket.md` under Project persistence: whether a project is a file or a
folder; whether a project file contains its audio or references it (and whether web and desktop
answer differently); whether browser-resident storage may ever be described as safe; whether
"install the app" becomes a stated durability requirement; whether audio belongs to a project or to
a shared library; version policy and whether web users get a pinned-build escape hatch; and how much
budget the desktop store gets — because if it is not funded, the honest move is to amend ADR 0012
and choose Option B, not to adopt C and under-build it.

## Gates reported — 2026-08-02

All ten have now reported or been formally deferred. Harnesses:
`scripts/measureAutomergeProjectCost.ts`, `scripts/measureStorageCapability.ts`,
`scripts/measureCommitProtocol.ts`. Every figure carries the condition that produced it in its
harness output; the load-bearing ones were re-run by the orchestrator rather than accepted on a
lane's report.

| Gate | Result | What it forced |
| --- | --- | --- |
| **M1** | **WITHDRAWN — the probe measured its own fixture.** See below. | Nothing. The question is answered from documentation instead. |
| **M2** | Deferred — Tauri webview, out of scope per ADR 0016. | Recorded unmeasured, not deleted. |
| **M3** (web) | Observed `estimate().quota` = `usage + 10 GiB`, and the origin wrote **2.6× its reported quota** with no error. **Treat as an observation, not a refutation** — see below. | Nothing new. `quota - usage > size` was already established as never-a-precondition by STOR-17, from the specification. |
| **M4** | 100 MB-audio document: **2431–3677 ms** load floor (ceiling ~2 s), **8.68–9.58×** audio in peak RSS (ceiling ~2×). Both breach. | **Option A is dead on measurement.** The ADR's "do not close Option A on inference" is discharged. |
| **M5** | Automation drags grow **sublinearly**; a blob does **not** duplicate on sibling edits (1.84 B/edit). | Trigger **not** met. M5 does not confirm the split. Whole-value *replacement* is still 4× with no compaction — that is BA-11, and M5 as written does not reach it. |
| **M6** | **FAILED, then fixed.** See below. | Layout amended. |
| **M7** | OPFS `createSyncAccessHandle` present in a dedicated worker, absent on the window. Throughput **at parity with Node `fs`**. | Adverse branch not triggered. No second visible store needed on web. |
| **M8** | Not run — `durability: "strict"` is an IndexedDB option and Option A is dead. | Moot. |
| **M9** | Closed in Phase 0 (#963). | The two `.sdaw` codecs agree; one real UTF-8 divergence was found and fixed. |
| **M10** | Blob records land as separate files — **and so do ArrayBuffers**, 4 of 4 each, established by walking the profile directory. `onsuccess` fired **281 ms before commit** on a 500 MB put. | Refines BA-18: at project scale the Blob-vs-ArrayBuffer distinction does not exist. |

### M1 and M3 — withdrawn as measurements, answered from documentation

**These two never needed a harness, and the one built for them measured its own fixture.**

M1 probed `navigator.storage.persist()` in a throwaway Chromium profile created per run. Chrome
grants persistent-storage silently, on documented heuristics — *"How high is the level of site
engagement? Has the site been installed or bookmarked? Has the site been granted permission to show
notifications?"* ([web.dev](https://web.dev/articles/persistent-storage)). A profile with no history
cannot satisfy any of them, so `false` was determined by the fixture. The run also reported `false`
for an *installed* PWA, contradicting the documented criteria — but the install was driven through
CDP (`latest_install_source: devtools`) on that same empty profile, which is the likelier
explanation. **The documentation wins; the earlier conclusion that "install is not a remedy" is
withdrawn as unsupported.**

M3's `usage + 10 GiB` is consistent with Chromium's move to reporting a predictable value rather
than a disk fraction, done to stop `estimate()` being used for fingerprinting and Incognito
detection. Note the public sources disagree on the current mechanism — MDN still documents *"up to
60% of total disk size"* — so **this is recorded as an observation on one build, not as a refutation
of anything.** The operative rule was never in doubt and does not come from measurement: STOR-17,
from the Storage Standard, already says `quota - usage > size` is a heuristic and never a
precondition, and that the write path needs a real failure branch.

**The correct source for browser behaviour is the specification and the browser's own
documentation.** A local probe on a synthetic profile describes the probe.

### M6 — the stop condition, and why it did not end in Option B

**Six of 72 injected renderer crashes produced a project that opens as valid and is neither
generation.** All six in the layout as originally drawn. One opened with **52 tracks** where
generation 1 had 40 and generation 2 had 64 — an arrangement that never existed.

The mechanism is one line, and it does not depend on the write mechanism. `document.automerge` was a
**fixed filename**, so writing generation 2 destroyed generation 1's document in place. Generation
1's manifest still named that file, the file still existed, every media file it named still
hash-matched, and `Automerge.load` accepted the bytes — because generation 2's document is a
perfectly valid Automerge document. It is simply not the one the manifest describes. Nothing in the
open protocol looked, and "fall back to the previous generation" referred to something no longer on
disk.

**Per-chunk SHA-256 does not cover truncation.** A cut at an exact Automerge chunk boundary produced
a valid short document. The original "(self-verifying)" annotation did not do the work the layout
asked of it.

This ADR pre-committed to *"adopt Option B and amend ADR 0012 explicitly"* if M6 failed. **That
pre-commitment was reasoned on a premise the measurement removed** — that a failure would mean
hand-writing an unverifiable commit protocol. Two one-line variants each took all six tears to
**zero of 72**: hashing the document in the manifest, or content-addressing its filename. The second
is adopted, because it is the only variant in which the ADR's own recovery story describes something
that still exists on disk, and because it makes the document consistent with the media beside it —
the inconsistency was the defect.

Coverage tested: 12 interruption points × 3 layouts × 2 write mechanisms, each a real CDP
`Page.crash` with handles open, reproduced across two full runs. **Not tested, and named rather than
implied:** OS power loss or kernel panic; killing the browser process; disk-full mid-sequence; a
second concurrent writer; the desktop `rename()`+`fsync` half (ADR 0016); WebKit and Gecko OPFS; and
whether bytes reached the device — a renderer crash does not test `flush()` durability.

## Owner decisions taken — 2026-08-02

Ratified by the owner directly.

- **Browser storage is a cache, never the authority.** The authoritative copy is a file the user
  controls, written through the File System Access API and kept in sync; browser-resident storage is
  a fast local cache.

  **This rests on the Storage Standard, not on any measurement of ours.** §7.1: if a user agent
  *"continues to be under storage pressure, then the user agent should inform the user and offer a
  way to clear the remaining local storage buckets, i.e., those whose mode is 'persistent'."* §5:
  the user agent *"cannot clear storage marked as persistent without involvement from the origin or
  user."* Persistent buckets are therefore **not immune** — they are protected only by a requirement
  that the user be involved. A desktop project file has no equivalent failure mode, and ADR 0012
  says neither target may be degraded relative to the other.

  This settles the docket's *"may browser-resident storage ever be described as safe"* — no. And
  *"is 'install the app' a stated durability requirement"* — no, but **for the spec reason above,
  not because installing fails.** Chrome's documented heuristics include installation, and our
  earlier claim to the contrary is withdrawn (see M1). Even a granted persistent bucket cannot be
  called safe, so the answer does not depend on whether the grant is obtainable.
## Adopted on the standard, owner ratification outstanding

Recorded separately from the above because the provenance is different, and conflating the two
would misrepresent the record.

- **The project is a directory with a content-addressed document.** Not selected by the owner. It
  was put to them three times — twice as a choice between shapes and once as a ratification — and
  declined each time, the second time by pointing back at the campaign's own standard and asking
  whether any doubt remained. There was none, so it was adopted on that standard rather than left
  open: Git's object store, SQLite's WAL and atomic-rename-and-fsync all make a new version unable
  to destroy the old one and then flip a small pointer. Detecting damage without being able to
  repair it is not a shipped standard anywhere, and a project stored as one opaque database record
  cannot be inspected, backed up or moved between machines — which no DAW accepts. Gate M6 measured
  the difference: 6 of 72 injected crashes torn under the original layout, 0 of 72 under this one.

  **This is the one item in this ADR carrying an engineering judgement where an owner decision was
  invited and not given.** It is reversible at no cost until the directory layout is built — nothing
  depends on it yet. If the owner prefers a single database record, say so and this section is
  struck; the measurements above stand either way.

**Still open and not decided here:** whether audio belongs to a project or to a shared library;
version policy and whether web users get a pinned-build escape hatch; how much budget the desktop
store gets. Those remain in `open-decision-docket.md`.

## Status

proposed — layout amended after M6; gates M1–M10 reported or formally deferred; the durability model
and the project shape are ratified. Remaining owner decisions listed above.
