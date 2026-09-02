---
type: adr
id: 0041
title: LLM batches may bind a newly created track or clip
status: accepted
date: 2026-09-02
owner: The Sourdaw team
sources:
    - src/modules/AiRuntime/useCases/agentReference/batchLocalBindingProducers.ts
    - src/modules/AiRuntime/useCases/agentReference/projectBatchLocalCreation.ts
    - src/modules/AiRuntime/useCases/agentReference/isAgentReferenceCapabilityCandidate.ts
    - src/modules/AiRuntime/useCases/agentReference/bridgeGroundedLlmToolCalls.ts
    - src/modules/AiRuntime/useCases/compileArbitraryCommandList.ts
    - src/modules/AiRuntime/useCases/validateArbitraryCommandListEvidence.ts
    - src/modules/Command/useCases/executableAppActionRegistry.ts
    - src/modules/Arrangement/useCases/clip/addClip.ts
    - docs/architecture/decisions/0030-llm-batch-local-bus-bindings.md
    - https://github.com/jcosta33/sourdaw/issues/3275
---

# 0041 - LLM batches may bind a newly created track or clip

## Context

[Architecture ADR 0030](../../docs/architecture/decisions/0030-llm-batch-local-bus-bindings.md) opened the
batch-local `$binding` grammar for `createBus` alone and deferred every other creation until it
could prove an internal identity and a capability mapping of its own. That leaves the most ordinary
musical request — make a track, put a clip on it, write notes into the clip — impossible as one
atomic plan, because the provider cannot know either application-owned ID in advance.

`addTrack` and `addClip` both already accept a pre-supplied identity on their AppAction payload and
record it as an application-assigned ID, so the identity half of the deferral is discharged. What
was missing is the capability half: which target capabilities an object that does not exist yet may
satisfy.

## Decision

`addTrack` and `addClip` join `createBus` as batch-local binding producers. Later calls in the same
plan may target them as `$<binding>`.

One shared table is the single source of truth for which catalog command may mint a binding, which
application-owned argument carries the minted identity, and which capabilities the created object
may satisfy. The compiler, the evidence re-validator, and the grounding bridge all read that table
rather than restating the rule, because three independent restatements are three chances to
disagree about what a plan-created object is.

The capability grants are static and snapshot-independent. They mirror the canonical contract in
`isAgentReferenceCapabilityCandidate` for the kind of object the command will create, evaluated as
if the object already existed. Two consequences follow and are load-bearing:

- A freshly created clip has no notes, so `editable-midi-clip` — which the canonical contract grants
  only to a clip that already has some — is never granted to a batch-local clip. `writable-midi-clip`
  is, which is what lets `addNotes` name it.
- A created clip's type follows its parent track exactly as the arrangement handler derives it: MIDI
  under a MIDI track, audio everywhere else. The grant is therefore read from the plan's own parent,
  which may itself still be a `$binding`.

A created object is also projected into the plan's temporary grounding context, so a later concrete
check sees the object the plan will actually produce rather than a snapshot that predates it. The
projection mirrors what the creating handler writes.

Minted identities keep a per-kind prefix — `bus-ai-`, `track-ai-`, `clip-ai-` — so an identity can
never be matched against the wrong action type, and the application refuses any creation identity
whose shape does not match its own action.

`addDevice` stays off the provider-facing `$binding` grammar. It mints an internal device identity
for its own replay, but a device is only addressable inside an owner that already exists, so there
is nothing for a provider to bind it to.

Everything Architecture ADR 0030 fixed still holds and is not restated here: the binding grammar, uniqueness,
visibility only after the producing call, rejection of missing, duplicate, malformed, forward and
capability-incompatible references, prompt evidence for a bound target, and removal of binding
metadata before strict RuntimeAction validation.

## Consequences

A provider can express track, clip and note creation as one atomic plan that preflights, previews,
partially accepts, and undoes as a unit.

Adding a further producer is a row in the shared table plus its capability mapping, not a new branch
in three files. The cost is that the table must be re-derived against
`isAgentReferenceCapabilityCandidate` whenever the canonical capability contract changes; a grant
that drifts from it would admit a target the concrete contract would refuse.

This decision extends Architecture ADR 0030. It does not supersede it.
