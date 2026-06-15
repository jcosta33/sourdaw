# Plugin-hosting failure catalogue

Assume failure is normal. Plugin hosting is the subsystem most exposed to
third-party, platform-specific, and out-of-process behavior, so every phase has a
failure mode that must be planned for rather than discovered in production.

**Overriding rule: failures must not silently corrupt project truth.**

## Failure modes to plan for

| Failure mode | Where it surfaces | What must not happen |
| --- | --- | --- |
| Plugin load failure | Instantiation | Project truth left in an undefined half-added state |
| Scan failure | Scan metadata | One bad plugin aborting the whole scan |
| Missing capabilities | Capability reporting | Host assuming a capability the plugin lacks |
| Editor creation failure | Editor management | RT/processing path affected by a UI-only failure |
| Unsupported formats | Discovery / scan | A format silently treated as supported |
| Runtime crash / hang | Audio processing / isolation | The host process crashing with the plugin |
| State restore failure | State save/restore | Saved project truth being overwritten or lost |
| Platform-specific GUI issues | Editor management | A platform quirk corrupting cross-platform project truth |

## Instantiation failure semantics must be explicit

If a plugin is added in project truth but runtime instantiation fails, define
explicitly — in the design, not by accident — which of these holds:

- the project mutation **rolls back** (the slot never existed), or
- the slot **remains with an error state** (visible, recoverable, non-processing), or
- the failure is **recoverable via retry** (the slot persists and re-instantiation
  is offered).

Do not leave this ambiguous. An undefined answer here is the path by which a load
failure silently corrupts project truth.

## Isolation expectations

- Crash/hang isolation state is runtime state, never project truth.
- A failed plugin must degrade to a visible, non-processing slot — not a silent
  drop and not a host crash.
- Recovery workflows (rescan, reload, retry) run on the slow path, never on the
  RT/audio path.
