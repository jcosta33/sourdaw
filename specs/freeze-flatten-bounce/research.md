---
type: research
id: RESEARCH-freeze-flatten-bounce
title: Freeze / flatten / bounce semantics across commercial DAWs
status: open
owner: The Sourdaw team
sources:
  - Survey of Ableton Live, Logic Pro, Pro Tools, Cubase, Studio One, Reaper, FL Studio, Bitwig
  - Open-source DAW architectures (Ardour, LMMS)
---

# Research: Freeze / flatten / bounce semantics across commercial DAWs

## Question

How do shipping DAWs render tracks to audio (freeze / flatten / commit / bounce),
which edge cases recur across all of them, and what offline-render, state-model, and
file-lifecycle architecture should Sourdaw adopt?

## Findings

### R-001 — The two-phase model (reversible freeze + irreversible flatten) wins

- **Claim:** DAWs that separate a reversible freeze (CPU savings) from an
  irreversible flatten/commit report better user satisfaction than those offering
  only a one-step destructive operation; the split maps to "experiment freely, then
  lock down."
- **Evidence:** Ableton (Freeze + Bounce Track in Place), Logic (Freeze + Bounce in
  Place), Pro Tools (Freeze + Commit) all ship both; FL Studio's lack of a freeze is
  its most-requested missing feature across years of forum threads.
- **Confidence:** high
- **Bears on:** the five-state machine and the separate flatten requirement.

### R-002 — Freeze must keep the mixer live

- **Claim:** Across DAWs, freeze bakes source content and inserts but leaves volume,
  pan, sends, mute, and solo editable; baking sends is rare (only Cubase's Complete
  Signal Path mode).
- **Evidence:** UX semantics comparison table — sends "remain live" in Ableton,
  Logic, Pro Tools, Studio One; only Cubase Complete Path bakes them.
- **Confidence:** high
- **Bears on:** AC-002 (mixer stays live).

### R-003 — Sidechain is the number-one freeze pain point

- **Claim:** Freezing a track in isolation breaks sidechain, because sidechain needs
  inter-track signal. Ableton blocks the operation; Logic and others silently render
  without the sidechain, producing wrong audio.
- **Evidence:** Recurrent top-five complaint on Reddit, Gearspace, KVR, VI-Control;
  Ableton surfaces an error dialog refusing the freeze.
- **Confidence:** high
- **Bears on:** AC-009 — include sidechain source tracks in the render subgraph.

### R-004 — Staleness detection is novel; no surveyed DAW does it

- **Claim:** No commercial DAW detects when frozen content becomes outdated after an
  edit; a content-hash overlay (clips + positions + device states) can fill the gap
  cheaply.
- **Evidence:** Survey found no freeze-staleness feature; SHA-256 over a canonical
  clip/device representation is deterministic and fast to compare.
- **Confidence:** medium
- **Bears on:** AC-003 / AC-004 (stale state + hash detection).

### R-005 — Shared graph with dual executors avoids code duplication

- **Claim:** A single audio-graph `process_block()` driven by interchangeable
  real-time vs offline executors keeps render fidelity matched to playback.
- **Evidence:** Ardour's JACK "freewheel" mode and LMMS's shared
  `renderNextBuffer()` both run the same processing path offline; CPAL is real-time
  only and is bypassed for offline render (use `hound` for WAV out).
- **Confidence:** high
- **Bears on:** offline render pipeline reusing the existing `OfflineAudioContext`.

### R-006 — Tails get truncated unless explicitly queried

- **Claim:** Reverb/delay tails are cut unless the renderer queries plugin tail
  length and continues past content end; infinite-tail plugins need a silence cutoff.
- **Evidence:** Only Studio One auto-detects tails well; the robust approach renders
  until output RMS stays below −96 dB for 512 consecutive samples.
- **Confidence:** high
- **Bears on:** AC-010 (render length covers tails).

### R-007 — Orphaned freeze files bloat projects without GC

- **Claim:** Repeated freeze/unfreeze cycles accumulate dead WAV files quickly; a
  50-track session with 10 iterations can reach gigabytes of orphans.
- **Evidence:** Pro Tools never auto-cleans `Rendered Files`; Ableton leaves orphans
  in edge cases. A mark-and-sweep keyed on current state + undo history, with
  age-based eviction, addresses it.
- **Confidence:** high
- **Bears on:** AC-011 (GC) and the freeze-file lifecycle requirements.

### R-008 — Atomic temp-file writes prevent corrupt freezes

- **Claim:** Writing to `.tmp` then atomically renaming, plus deleting stray `.tmp`
  files on startup, prevents partial renders from being treated as valid.
- **Evidence:** Standard crash-safe write pattern; pairs with a watchdog that reverts
  a stuck `freezing` state.
- **Confidence:** high
- **Bears on:** freeze-file management and progress/cancellation requirements.

### R-009 — Concurrent freeze resolves cleanly under LWW

- **Claim:** Two peers freezing one track both write `frozen` with different files;
  last-writer-wins picks one and the loser becomes GC-eligible. A UI lock indicator
  reduces wasted renders.
- **Evidence:** CRDT Map LWW semantics on the freeze state; staleness check covers
  the freeze-while-edit case.
- **Confidence:** medium
- **Bears on:** AC-012 (LWW resolution).

## Open questions

- [ ] Q-001 — Disk-space pre-check margin: 2× vs 3× of estimated render size before
  rejecting a freeze. Unblocks the error-handling requirement's threshold.
- [ ] Q-002 — VST3 `processMode = kOffline` during freeze, with a real-time render
  fallback for plugins that behave differently offline. Unblocks plugin-fidelity scope.
- [ ] Q-003 — Archive packing modes (Full / Minimal / Smart) for project sharing —
  ship in v1 or defer. Smart packing needs plugin-availability detection on the recipient.

## Recommendation

Adopt the two-phase model (R-001) on a five-state machine with hash-based staleness
(R-004), reuse the existing offline-render infrastructure under a shared-graph executor
(R-005), include sidechain sources and plugin tails in the render (R-003, R-006), and
manage freeze files with atomic writes plus mark-and-sweep GC (R-007, R-008). Resolve
concurrent freezes with LWW and a UI lock indicator (R-009). Keep the existing CRDT
engine rather than migrating to Loro — the freeze state is a small per-track map and
does not justify a collaboration-system rewrite.

---

## Restored detail from the original research (migration recovery)

The condensed findings above lost several sections that were present in the original
research note (`research/factory/active/freeze-flatten-bounce.md`). They are restored
here verbatim where practical so the spec's pointers to `research.md` resolve to real
content. Implementation-language specifics (Rust traits, Loro, taurpc) are recorded as
historical research detail only — the spec's "## Dropped from sources" and Design
Decisions remain canonical for what Sourdaw actually adopts.

### R-010 — Crash during freeze render (watchdog + atomic temp files)

> The atomic temp-file pattern prevents partial WAV files from being treated as valid
> freezes. On crash recovery, the frontend sees `status: 'freezing'` in the CRDT with
> no corresponding `freeze-complete` event. A **watchdog timer** (5 minutes) transitions
> the state back to `unfrozen` and cleans up any `.tmp` files.

This is the detail behind R-008's one-line "pairs with a watchdog that reverts a stuck
`freezing` state." Bears on the spec's progress/cancellation/watchdog requirement.

### R-011 — Disk space exhaustion (size estimate + rejection + cleanup-on-error)

> Before rendering, the system estimates the output file size (`duration_seconds ×
> sample_rate × channels × bytes_per_sample`) and checks available disk space with a
> **2x safety margin**. If space is insufficient, the freeze is rejected with a dialog
> prompting the user to free space or run GC on old freeze files. During rendering,
> write errors are caught, partial files are cleaned up, and the track reverts to
> `unfrozen`.

Bears on the spec's error-handling requirement (the 2× vs 3× margin is Q-001).

### R-012 — Plugin state mismatch after freeze but before flatten

> The `pluginChainHash` in freeze metadata enables a pre-flatten safety check. If the
> user changes a plugin parameter after freezing but before flattening, the hashes
> differ. The flatten dialog warns: _"Plugin settings changed since this track was
> frozen. Flattening will commit the older rendered audio, not the current plugin
> state."_ The user can choose to re-freeze first or proceed.

Bears on the spec's flatten pre-warning requirement.

### R-013 — Render-depth and bounce-in-place option models across DAWs

Cubase's **Render in Place** offers four render-depth levels: **Dry → Channel →
Complete Path → Complete + Master** ("Dry" transfers channel settings without baking
them in; only Complete Signal Path bakes sends). Logic's **Bounce in Place**
(`Ctrl+Cmd+B`) opens a dialog with: include/exclude insert effects, include audio tail
in file and/or region, include volume/pan automation, normalization (off / overload
protection / full), destination (new track or selected track), and source granularity
(one file, one per track, or one per region). Bears on the spec's bounce-options
requirement.

### R-014 — Project packing / archiving modes

Three modes serve different sharing scenarios:

> - **Full**: Include all freeze files. Largest archive, but loads instantly without
>   re-rendering. Best for handoff to a mixing engineer.
> - **Minimal**: Exclude all freeze files. Smallest archive; all frozen tracks must
>   re-render on open. Best for backup/version control.
> - **Smart** (default): Include freeze files only for tracks whose plugins may be
>   unavailable on the recipient's system. The system checks each frozen track's
>   `pluginChainHash` against locally installed plugins — if a plugin is missing, the
>   freeze file is essential and gets included.

Survives above only as the deferred open-question Q-003; this is the full subsection.

### R-015 — Implementation-level specifics (recorded as research history)

The original research proposed a native Rust pipeline that Sourdaw deliberately did not
adopt (see Design Decisions / "Dropped from sources"). Captured here for traceability:

- **GraphExecutor / AudioNode trait design**: every node implements
  `process(context, inputs, output)`, `reset()`, `latency_samples()`, `tail_samples()`;
  a `ProcessContext { sample_rate, block_size, transport, is_offline, tempo_map }` is
  shared between real-time and offline paths; `AudioGraph::process_block()` is
  executor-agnostic, walking a Kahn topological schedule over pre-allocated buffers.
- **OfflineExecutor render loop**: writes to a `.tmp` WAV via `hound`, then atomically
  `rename`s on completion; iterates `total_blocks` pulling `master_output()` per block
  and reporting progress over a channel.
- **`bounce_chunk_size = 8192`**: offline block size (4096–8192 samples), following
  Ardour; real-time path uses the hardware block size (256–512).
- **Loro rationale**: MovableList (Fugue-merged reorderable tracks/clips), MovableTree
  (hierarchical track/bus structures), LWW Map (per-track properties), built-in
  per-peer UndoManager, Frontiers time-travel — chosen over Yjs (no native Rust /
  MovableTree / MovableList) and Automerge (higher memory overhead). Sourdaw kept
  Automerge regardless (Design Decisions).
- **taurpc / Specta IPC**: auto-generate TypeScript types from Rust trait definitions.
- **16 ms debounced batching**: CRDT changes coalesced into one-animation-frame batches;
  < 10 tracks changed → incremental per-track updates, else a full project snapshot.

### R-016 — Per-DAW traceability specifics (restored)

The condensed findings thinned the per-DAW detail. Restored from the original research
and the implemented spec's R17 traceability block:

- **Ableton** — freeze to 32-bit float WAV under `Samples/Processed/Freeze/`; refuses
  to freeze tracks with active sidechain input; Arrangement-view reverb/delay tails
  render as separate tail clips, Session-view folds ~2 loop cycles; **Live 12.2 renamed
  Flatten to "Bounce Track in Place"**.
- **Logic Pro** — **Source Only (blue indicator, effects remain live) vs Pre-Fader
  (green, full chain baked)**; cannot freeze multi-output software instruments;
  documented PDC bug on high-latency plugins; automation can fire at incorrect times
  during freeze.
- **Pro Tools** — **Freeze Up To This Insert (partial freeze)**; cannot freeze external
  hardware inserts (offline rendering produces silence).
- **Cubase** — RIP with configurable depth; Complete Signal Path is the only mode that
  bakes sends.
- **Studio One / Reaper / FL Studio / Bitwig** — varying levels of transform/bounce;
  see the UX semantics comparison table for the full breakdown.
