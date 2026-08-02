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
  manifest.json          small, versioned, written last — the commit point
  document.automerge     Automerge save() bytes (self-verifying: per-chunk SHA-256)
  media/<hash>.wav       raw float32 PCM, content-addressed, byte-range readable
```

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

## Status

proposed — pending owner ratification and gates M1–M10
