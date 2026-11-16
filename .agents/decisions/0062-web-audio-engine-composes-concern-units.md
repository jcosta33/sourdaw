---
type: adr
id: 0062
title: The web audio engine composes concern units behind a repository seam
status: accepted
date: 2026-11-14
owner: The Sourdaw team
sources:
    - .agents/decisions/0011-ddd-module-boundary-redraw.md
    - src/modules/AudioEngine/repositories/createWebAudioEngine.ts
    - src/modules/AudioEngine/repositories/__tests__/createAudioEngineTopologyTestHarness.ts
    - docs/architecture/03-typescript-module.md
    - docs/01-dependency-injection.md
---

# 0062 - The web audio engine composes concern units behind a repository seam

## Context

The browser audio engine is one class in `createWebAudioEngine.ts` that holds the transport clock,
the master section, scheduled sources, audio preview, send and sidechain routing, Toaster pad
routing, runtime-graph revisions, track and bus strips, lifecycle and diagnostics in one shared set
of private fields. Every concern can read and write every other concern's state, so a change to one
cannot be reviewed without the whole file. A test-only subclass lived in the production file to
reach protected device operations, and repository specs cast the engine to reach private state, so
the specs pinned field names rather than a declared surface.

## Decision

The web audio engine is composed from concern units under
`src/modules/AudioEngine/repositories/webAudioEngine/`. Each unit is a `create<Unit>(ports)` factory
function that owns its own state and reaches other units only through narrow ports passed at
composition. There is no class hierarchy and no shared mutable state bag. The units are: transport
clock; master section (master chain, meter, control-room insert); scheduled sources; audio preview;
send routing; sidechain routing; Toaster pad routing; runtime-graph revision and delta application;
track and bus strips with their device operations; lifecycle; diagnostics.

`createWebAudioEngine.ts` is the composer, and `composeWebAudioEngine(providedContext?)` is the
one function it exports; it returns `{ engine, internals }`. The import-time `audioEngine` is
`composeWebAudioEngine().engine`, created at module evaluation, because the AudioContext's
construction time, before any user gesture, decides its autoplay state, and `src/app/bootstrap.ts`
registers against that instance at import.

Graph reset and disposal keep one ordered effect list. Each unit contributes its own effects and the
composer concatenates them in a fixed order, because teardown order is audible: sends and sidechain
edges disconnect before strips dispose.

`internals` is repository-internal and is never exported from a contract barrel. It is the only
route by which repository specs and the topology test harness observe or drive unit state; specs
never cast the engine to reach private state. It exposes only what a spec or the harness reads, and
it hands out the live collections, so a spec that mutates one mutates engine state.

Consumers take the engine through the repository's canonical dependency injection: an
`inject({ audioEngine })` dependency map (`docs/architecture/03-typescript-module.md` §4.11,
`docs/01-dependency-injection.md`), resolved at call time and substituted in specs with
`injectDependencies()`. No new port mechanism is introduced. Consumers migrate module by module.
Once every consumer injects it, a later stage moves the instance's creation into the composition
root (`src/app/registerDependencies.ts`, still evaluated at import before any user gesture) behind a
dependency-injection token, and the module-level `audioEngine` export is retired. Audio-thread code
never injects the engine, because it never touches the engine object.

This fits ADR 0011. It is internal structure of AudioEngine's runtime graph, which 0011 places in
AudioEngineCore; it moves nothing across a module boundary and pre-empts none of 0011's extractions.

## Consequence

A concern's state can change only through its own unit or a port it published, so a review of one
unit no longer needs the whole engine. The test harness lives with the specs and builds on
`internals`, so the production file carries no test-only subclass or factory overload. Teardown order
stays a single reviewed list in the composer rather than an emergent order across units. Decomposing
the engine is staged: the seam lands first with the existing class behind it, and units move out of
the class one at a time behind the same `{ engine, internals }` shape.
