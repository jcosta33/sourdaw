---
type: adr
id: 0063
title: Per-device behaviour lives in exhaustive tables owned by the behaviour's module
status: accepted
date: 2026-11-16
owner: The Sourdaw team
sources:
    - src/utils/builtinDeviceTypes.ts
    - src/utils/nativeDspDeviceTypes.ts
    - src/modules/AudioEngine/models/noteInputKindByDeviceType.ts
    - src/modules/Arrangement/models/DeviceParameter.ts
    - .dependency-cruiser.module-tiers.cjs
    - crates/daw-engine/src/scheduler.rs
---

# 0063 - Per-device behaviour lives in exhaustive tables owned by the behaviour's module

## Context

`Device.type` is an open `string` persisted in project files. Production code decides what a device
does by comparing that string against quoted ids.

Measured on 2026-11-16 at `origin/main` e5152dd5a4:

- 128 production files hold 225 lines comparing a quoted device type (`===`, `case`,
  `startsWith('builtin-…')`, `.has`).
- 17 more files compare through `DEVICE_TYPE_IDS`.

Each comparison is a place someone must remember when a device is added, and nothing tells them
which ones. The note-input matchers lived in `src/utils/deviceTypeMatching.ts`, whose header
documented `src/utils` as a route around module cycles: behaviour placed in a module-less folder so
modules that could not reach each other could share it.

## Decision

1. **The vocabulary is domain-free and lives in `src/utils`.** `src/utils/builtinDeviceTypes.ts`
   holds the list of built-in device ids (catalog ids plus the legacy ids projects still carry), the
   `BuiltinDeviceType` union, and `resolveBuiltinDeviceType`. `src/utils/nativeDspDeviceTypes.ts`
   holds the native subset and `DEVICE_TYPE_IDS`. The resolver matches by own membership, so a raw
   string such as `constructor` or `__proto__` never resolves to an inherited member, and resolves an
   unlisted generated variant (`builtin-drum-machine…`, `builtin-synth…`) to its family's base,
   because the catalog builds every variant from its base descriptor. These ids are persisted wire
   values that name no module's language, which is the only reason they live in utils. The
   vocabulary holds no behaviour.

2. **Each behaviour concern is one exhaustive record over `BuiltinDeviceType`** in the module that
   owns that behaviour, typed `{ readonly [Type in BuiltinDeviceType]: … }` so a missing row fails to
   compile. Callers ask the owning module a question through its contract barrel; they never compare
   device-type strings themselves. A raw string reaches a table only through the resolver.

3. **Owners.** Runtime capabilities belong to AudioEngine: the note-input family and which instrument
   on a chain receives notes, the live note controls of worklet instruments, MIDI-transform devices
   that contribute no audio node, pad-output hosting, sidechain input, and offline sound sources.
   Device panels belong to WorkspaceShell. The tier manifest forbids core and engine modules
   importing device modules, so a device module cannot hold a table that those tiers read.

4. **Not a target.** These comparisons stay as they are:
    - a device module naming its own type;
    - AudioEngine node, worklet-processor and device-strategy code for the device it hosts;
    - catalog, descriptor and composition-root tables keyed by type;
    - demo and template content that creates a named device;
    - migration of a named legacy persisted key;
    - tests;
    - strings that only coincide with a device id (track roles, failure kinds).

5. **The Rust `PluginCore` enum is not mirrored.** `crates/daw-engine/src/scheduler.rs` constructs
   native device bodies through an exhaustive Rust match. The TypeScript tables answer graph and
   scheduling questions. Neither copies the other.

## Consequences

Adding a built-in device means adding its id to the vocabulary, which fails compilation in every
concern table until each of its rows is decided. A catalog weld spec in Arrangement keeps the
vocabulary and the catalog equal. The note-input concern moved first: `src/utils/deviceTypeMatching.ts`
is gone and AudioEngine answers it from `models/noteInputKindByDeviceType.ts`. Later slices move the
remaining concerns into their owners' tables.
