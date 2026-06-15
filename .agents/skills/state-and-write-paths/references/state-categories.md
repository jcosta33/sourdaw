# State categories

Every state value must be classified into exactly one of these eight categories before it is added
or moved. This is the full taxonomy that rule 1 of `../SKILL.md` references.

---

## 1. Project state

This is authoritative truth.

Examples:

- tracks
- clips
- routing definitions
- automation
- transport configuration
- tempo map
- markers
- plugin/device ordering
- saved parameter values
- preset references

Properties:

- serializable
- persistent
- undoable
- collaboration-relevant
- business-owned

---

## 2. Shared runtime state

This is app-wide runtime visibility that is not project truth.

Examples:

- engine ready status
- MIDI device list
- backend capability info
- plugin scan results
- native runtime availability

Properties:

- cross-feature visible
- not necessarily persistent
- not authoritative project truth

---

## 3. Persistent UI state

This is local preference state, not project truth.

Examples:

- zoom preference
- panel layout
- sidebar open
- workspace mode preference
- user inspector layout preference

---

## 4. Ephemeral UI state

This is temporary feature/view interaction state.

Examples:

- selection
- active tool
- drag state
- hover target
- scroll position
- temporary editor mode

---

## 5. Local component state

This is component-only state.

Examples:

- input draft
- temporary disclosure state
- local popover visibility
- one-component hover/focus flag

---

## 6. Engine/runtime state

This is runtime-owned and non-serializable.

Examples:

- `AudioContext`
- `AudioNode`
- plugin instance handles
- native windows
- DSP buffers
- live host/runtime objects
- engine handles

---

## 7. Telemetry

This is read-oriented feedback from runtime or long-running work.

Examples:

- meters
- displayed playhead position
- CPU/load stats
- underruns
- waveform extraction progress
- AI token stream progress
- render progress

Telemetry is not project truth unless explicitly committed through an application action.

---

## 8. Async fetch/cache state

This is request-oriented state.

Examples:

- remote metadata query results
- cached search results
- request loading/error state
- suspense/query cache state

This should not automatically be confused with project truth or general UI state.
