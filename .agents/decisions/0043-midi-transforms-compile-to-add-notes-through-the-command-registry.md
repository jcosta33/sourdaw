---
type: adr
id: 0043
title: Deterministic MIDI transforms compile to addNotes through the command registry
status: accepted
date: 2026-09-03
owner: The Sourdaw team
sources:
    - src/modules/Command/models/MidiTransform.ts
    - src/modules/Command/stores/midiTransformRegistry.ts
    - src/modules/Command/useCases/expandMidiTransform.ts
    - src/modules/Command/useCases/getExecutableAppActionIntentCatalog.ts
    - src/modules/Command/useCases/getMidiTransformToolSchemas.ts
    - src/modules/AiGeneration/useCases/midiTransforms/midiTransformImplementations.ts
    - src/modules/AiRuntime/useCases/compileArbitraryCommandList.ts
    - src/modules/AiRuntime/useCases/getAgentToolCatalogEntries.ts
    - src/modules/AiRuntime/transformers/llmActionBridge.ts
    - src/app/bootstrap.ts
    - src/utils/midiNoteBatchLimits.ts
    - .agents/decisions/0041-llm-batch-local-track-and-clip-bindings.md
    - .agents/decisions/0042-high-level-intent-compiles-through-the-bounded-catalog.md
    - https://github.com/jcosta33/sourdaw/issues/3276
---

# 0043 - Deterministic MIDI transforms compile to addNotes through the command registry

## Context

[ADR 0042](0042-high-level-intent-compiles-through-the-bounded-catalog.md) settled how a musical
request reaches the catalog: it searches the command index, discovers exact schemas, and returns one
bounded proposal. What it left the provider holding is the music itself. Asked for a twelve-bar blues
progression, a language model has to write every note of it into an `addNotes` argument — pitch by
pitch, beat by beat, from a model whose sense of a bar is a statistical one.

That has three costs a DAW cannot pay. The notes are not reproducible: the same request twice gives a
musician two different progressions and no way to ask for the first one back. They are not
inspectable before they land, because nothing about a list of integers says which harmony it claims
to be. And they consume the proposal's whole note budget with tokens, so the wider the musical
request the more likely the batch is truncated or malformed.

Sourdaw already owns generators for exactly this material. `AiGeneration` holds pure, seeded
functions for chord progressions, drum patterns and melodies — the same ones the pattern browser
calls. The question this ADR settles is how a planner reaches them without giving the AI runtime a
second execution path into the project.

## Decision

A **deterministic MIDI transform** is a catalog entry the planner discovers exactly like a command,
and which the application expands into ordinary `addNotes` commands before anything is proposed for
approval. Nothing new executes: the project only ever receives `addNotes`.

**The command module owns the contract.** `Command/models/MidiTransform.ts` declares the transform
names, their parameter schemas, and the bounds those parameters carry — including `clipId`, `bars`
and a `seed` that defaults rather than being invented per call. `Command/stores` holds the registry
of generators, and `Command/useCases/expandMidiTransform.ts` is the single route from a requested
transform to commands. The contract is published to the planner through the same intent catalog and
the same discovery schemas commands use, so a planner needs no second protocol to find or read one.

**The generating module supplies only implementations.** `AiGeneration` registers one adapter per
transform name at bootstrap. Neither `Command` nor `AiRuntime` imports it: the registry is the whole
of the coupling, which is what keeps the dependency graph acyclic while the generators stay where
their algorithms already live.

**Expansion is a validation, not a courtesy.** A transform is refused, with a reason naming what was
wrong, when it is not registered, when an argument is undeclared or out of its published bounds, when
its bars do not fit the target clip, when its generator throws, or when a note it produced falls
outside the clip or the MIDI ranges. An adapter never clamps and never substitutes: a value it cannot
honour is a contract drift between the two sides, and a refusal that names it is worth more than a
silently altered part. A transform wide enough to exceed the per-command note bound occupies several
`addNotes` commands rather than a special wider one.

**The compiler splices, it does not execute.** `compileArbitraryCommandList` recognises a transform
item, resolves the span of the clip it targets — from the producing item for a clip the same batch
creates, from the project snapshot for an existing one — expands it, and puts the resulting
`addNotes` commands in the item's place, carrying the item's own dependencies. They then pass through
every check an author-written `addNotes` passes: grounding, write-conflict composition, the command
budget, and the bridge's per-note window validation. The batch's evidence records which transforms
were expanded, because after expansion nothing else in the batch could tell a musician that the notes
came from a named generator and a seed.

**A transform is one bounded write.** It takes no bulk selector and no repeat count. It writes one
clip, so it registers one write identity however many commands its note count costs, and a second
item writing that same clip still collides with it.

## Consequences

The same request, with the same seed, produces the same part — so a musician can ask for a variation
by changing one number, and the plan that produced a part is a description of it rather than a
transcript. The provider's note budget is spent on structure instead of on pitches, and a sixteen-bar
progression costs the same proposal size as a one-bar one.

The bound on how much music a transform may write is stated as a whole number of `addNotes` commands,
derived from the per-command note cap rather than written as a second free number, so the two cannot
drift apart.

A transform whose generator can place a note past the end of the bars it was asked for — a swung
offbeat at the very end of the last bar is the worked example — is refused rather than trimmed. The
refusal names the note and both spans. Swing defaults to straight for that reason, and a caller that
asks for swing on a clip with no room after the final downbeat gets told so.

A descriptor is only visible once its generator is registered. Publishing a schema a planner can
discover but nothing can run would turn a wiring gap into a refusal the planner has no way to
interpret, so the catalog and the registry answer together or not at all.
