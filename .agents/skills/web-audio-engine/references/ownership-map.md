# Ownership map — what belongs where, latency, and transport

The engine is a runtime executor, not the business model. This file is the full
boundary catalogue that the core rules summarise.

## Architectural role

### The engine is a runtime executor, not the business model

Project truth lives outside the engine. The engine consumes a projection of
project truth and turns it into runtime execution.

Project truth may include:

- tracks
- clips
- routing definitions
- plugin/device chains
- automation data
- transport configuration
- markers
- saved parameter values

The engine may own:

- live playback state
- runtime graph objects
- scheduling windows
- transport execution state
- meter accumulators
- temporary runtime caches
- worklet nodes
- runtime-only latency state

The engine must not become the owner of persisted semantics.

### The engine owns time, routing, and playback execution

The UI may:

- send commands
- request transport changes
- request parameter changes
- subscribe to summarized engine state
- display meters, playhead, timing readouts, and transport state

The UI must not:

- own playback time
- own routing topology
- mix audio
- schedule clips directly
- mutate the live graph ad hoc
- keep transport truth in React state

## What belongs where

### Belongs in engine/runtime code

- transport execution
- scheduling windows
- graph ownership
- worklet lifecycle
- routing execution
- bus topology
- metering taps
- latency compensation runtime application
- playback position execution
- offline rendering

### Belongs outside the engine

- UI layout and editor state
- selection
- project-level ownership rules
- save/load workflows
- command parsing
- AI intent interpretation
- non-runtime validation
- view presentation formatting

## Latency and transport guidance

### Latency compensation is an engine concern informed by project truth

Compensation values may be derived from project/plugin/routing truth, but applying
them to live playback is an engine/runtime responsibility.

### Transport must be engine-owned

The UI should never become the source of truth for:

- playback phase
- playhead progression
- loop execution
- scheduling boundaries

It may display transport summaries and request transport changes.
