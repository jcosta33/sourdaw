---
type: adr
id: 0065
title: Cross-module dependencies arrive as registered ports, filled by explicit composition-root calls
status: accepted
date: 2026-11-21
owner: The Sourdaw team
sources:
    - docs/architecture/03-typescript-module.md
    - docs/01-dependency-injection.md
    - src/app/bootstrap.ts
    - src/app/registerDeviceEnginePorts.ts
    - src/modules/Transport/useCases/scheduling/kitSwing.ts
    - .agents/decisions/0062-web-audio-engine-composes-concern-units.md
---

# 0065 - Cross-module dependencies arrive as registered ports, filled by explicit composition-root calls

## Context

A module that may not import a collaborator, because the module tier order or a cycle forbids it,
receives the collaborator at runtime. The repository grew several shapes for that: an `export let`
binding the consumer reads directly, a setter that also accepts `null`, a reader that silently skips
its work when nothing was registered, and a reader that throws a named error. `src/app/bootstrap.ts`
performed every registration as a statement evaluated at import, and `src/app/App.tsx` registered
some ports again at its own import, because `main.tsx` evaluates the two graphs independently and
either may finish first. Whether a slot was filled when first read therefore depended on which
import finished first, and specs set and cleared slots by hand to reproduce either state.

## Decision

A dependency is reached in this order of preference:

1. A static import, when the collaborator lives in the same module or in a module the tier order
   lets this one depend on.
2. A parameter, when the caller already holds the collaborator.
3. `inject()` (`docs/architecture/03-typescript-module.md` §4.11), for a use case's mockable
   collaborators such as event buses and loggers.
4. A registered port, only when the tier order or a cycle forbids the import.

A registered port is the shape `src/modules/Transport/useCases/scheduling/kitSwing.ts` already
uses. The consuming module owns it. The implementation sits in one module-private `let`, which is
the only mutable binding. The port exposes one fill function and a reader. A port keeps the fill
name it already has (`configure`, `setProvider`, `set…Dependencies`), so a migration does not
rewrite its registrar. A fill stores the
implementation and replaces any earlier one; the existing ports that refuse a different second
fill, as `kitSwing.ts` does, keep that check. Reading an unfilled port throws an error naming the caller, the port
and the `src/app` registrar that fills it, because a reader that answers "nothing registered" by
skipping its work turns a wiring fault into wrong audio or lost project state with no report. A
port whose absence is a real product state declares that in its read type, for example by
returning `null` for "no collaboration session", and every caller handles it. The fill function
never accepts `null` to unregister.

Only the composition root under `src/app/` configures ports, through registrar functions. No
module exports a mutable binding: `import-x/no-mutable-exports` is an error. No module performs
registration as a side effect of being evaluated. `src/app/bootstrap.ts` exports one entry
function, and `main.tsx` calls it and the port registrars explicitly, each once, in an order that
`main.tsx` states. A registrar's position in that order, not import order, decides what is filled
when the first render or the first command runs.

Specs give a port its fake through the same fill function production uses, in the case or its
setup that needs it. Vitest evaluates each spec file in a fresh module graph, so a filled port never
leaks into another file, and no spec unfills a port.

Lazy caches, memoised values and owned runtime state (in-flight promises, timers, abort
controllers, worker-global state) are not dependencies and keep their module-level slots. Runtime
state other modules or the UI must observe belongs in a store.

No dependency-injection library is added. `Container` and `inject()` keep their current role.

## Consequence

A wiring fault fails loudly at its first read with the registrar to call, instead of silently
skipping. Registration order is one list a reviewer can read in `main.tsx` and the entry function.
Specs stop resetting ports between cases. Existing ports that already have this shape stay as they
are; the others migrate module by module.
