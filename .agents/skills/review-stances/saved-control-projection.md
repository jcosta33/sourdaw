# Lesson library: saved control projection

Persisted parameters must reach the first visible control even when optional engine registration never occurs. The earliest inspected persisted Proof scalar writer is commit `f4104009d7c5d34962bac931b85b26a195a7a6f0`; GitHub associates no pull request with it. PR #109 added restoration before full-patch synchronization, and PR #4169 added the extracted restoration path. The exact UI regression introduction and its historical reviewer stances and tiers are unknown.

PR #5749 addresses a saved Proof scalar that could first appear at its default until optional engine registration hydrated the cache. The blind spot was the initial visible value without registration and a mounted cache reset at the same disclosure tier, not whether Save or the device card worked. The panel uses the existing validated, read-only restore path.

Save a non-default parameter, close the original page, and reopen the explicitly saved snapshot in a fresh runtime before playback or editing. Assert its exact value on the visible control. Separately seed the persisted row, clear the module cache, and mount the actual panel without bridge registration; assert the same value. While mounted, reset the cache with the saved disclosure tier equal to the default tier and assert the saved value again before a gesture. Revert only the panel restoration call: the cold-value case must fail. Preserve validated read-only rehydration, initialized live state, stale-owner refusal, and live meters; assert there is no engine or project write. Unconditional UI admission and a genuine saved snapshot prevent a vacuous pass. UI evidence does not establish audible behavior or runtime-engine acceptance.

### 2026-10-29 — a declared Body choice never entered the worklet schema (PR #5254)

PR #5254 (`07182eab40171c11502e287c0da15a808fe09f11`) exposed the numeric Body chooser
while the existing finite Bacteria runtime schema omitted `convolutionIr`. Choosing Metal
could store `band0_convolutionIr = 2` without posting a control to the actual worklet.
Historical private review prompts and tiers are unknown; the missed probe was production
parameter admission between the real caller and receiver.

A restored visible Body choice or persisted index does not prove replay reached audio.
Trace the stored `band0_convolutionIr = 2` through the real factory's production target
allowlist and processor to the engine, retaining each band's exact index. Remove only
`convolutionIr` from the runtime schema: the factory probe must fail even if document and
visible-control assertions stay green. Use the production schema rather than a fixture's
permissive `parameterIds`; preserve finite-key and stale-identity refusal. Report this
carrier admission separately from saved-project UI, rendered PCM and listening evidence.
