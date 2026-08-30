---
type: adr
id: 0040
title: CRDT slot sanitizers are projections, not validators
status: accepted
date: 2026-08-30
owner: The Sourdaw team
sources:
    - src/infra/store/storage/createAutomergeStorage.ts
    - src/infra/store/createStore.ts
    - src/modules/Project/stores/arrangementStore.ts
    - src/modules/Automation/stores/automationStore.ts
    - src/modules/MIDI/stores/grooveTemplateAutomergeStorage.ts
    - https://github.com/jcosta33/sourdaw/pull/3032
    - https://github.com/jcosta33/sourdaw/pull/3152
    - https://github.com/jcosta33/sourdaw/issues/3162
    - https://github.com/jcosta33/sourdaw/pull/3163
---

# 0040 - CRDT slot sanitizers are projections, not validators

## Context

Every CRDT-backed store slot carries a writer/sanitizer pair: some path writes store state into the
document slot, and an inbound sanitizer (`createStore`'s `sanitize` over `createAutomergeStorage`)
rebuilds what this build accepts on the way back out. A third party watches the pair:
`findAutomergeStorageRawProjectionLosses` asks whether the sanitized projection still contains
everything the raw slot held, and any reported loss arms the agent repair-required verdict, which
refuses every project mutation, save, and export until the document changes.

Two independent lockouts reached users from the same structural gap: the sanitizer and the writer
disagreed about the slot's shape, and the detector faithfully reported the difference. In one, the
sanitizer sorted rows a reconciled document held in causal order, and the detector compared arrays
positionally. In the other, a writer embedded the live MIDI store's durable `probabilitySeed` into a
snapshot section whose sanitizer modeled three keys and dropped the fourth.

## Decision

1. A slot sanitizer is a projection of its slot, never a validator of it: it must preserve every
   durable field every writer of that slot embeds. Writers and sanitizers form one contract per
   slot; adding a durable field means extending the sanitizer in the same change, and a writer may
   embed wholesale only what the sanitizer fully models.
2. Sanitizers may normalize row order; they may not drop content. The loss detector's array
   containment is order-insensitive (every raw item must be contained by a distinct projected
   item), so sort-on-entry sanitizers are correct by construction and positional drift is not
   loss.
3. Content this build cannot read is dropped and reported as a loss on purpose. The detector's
   fail-closed verdict is never the thing to weaken: a false loss is repaired by aligning the
   writer/sanitizer contract above, and an adapter that owns a wire encoding unlike the store
   shape opts out per value through `ownsCrdtEncoding` and records the reason at its implementation
   site.
4. Any future detector over slot adapters asserts a global invariant and must be swept across the
   whole adapter population when introduced or repaired — validating only the adapters named in an
   incident leaves the class armed (see issue #3162).

Changing or adding a slot sanitizer runs `pnpm test:run` for that store's spec plus
`src/infra/store/storage/__tests__/createAutomergeStorage.rawProjectionLossReorder.spec.ts`; the
detector's contract is pinned there.
