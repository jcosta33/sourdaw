# Plugin-hosting lifecycle phases (expanded)

The body lists the nine separable concerns as a numbered rule. This file expands
each phase: what it does, what it must *not* absorb, and the project-vs-runtime
boundary that applies to it. Keep these phases distinct — if one abstraction owns
too many of them, it is probably wrong.

## Discovery

Discovery finds candidate plugins.

It should not become live-host orchestration. Finding a plugin file on disk is a
filesystem/registry concern; it does not instantiate, load, or run anything.

## Scan metadata

Scanning extracts, per candidate:

- names
- formats
- capabilities
- parameter summaries
- I/O capabilities
- editor support indicators

This should be **cacheable** and **failure-tolerant** — a plugin that fails to
scan must not abort the whole scan, and a successful scan result should survive a
restart without re-scanning every plugin.

## Capability reporting

Capability reporting answers "what can this plugin do" from scan metadata —
formats, channel layouts, editor support, parameter count. It reads from the
cache; it does not instantiate to answer.

## Instantiation

Instantiation creates a live runtime instance.

This is separate from discovery and may fail independently. A plugin can scan
cleanly and still fail to instantiate (missing runtime dependency, license check,
incompatible host version). The explicit instantiation-failure semantics this
must define (rollback / error-slot / retry) are covered in the body's rule 10.

## Parameter inspection

Parameter surfaces should remain host-visible whenever possible. Do not make
vendor GUIs the only control path — the host must be able to enumerate, read, and
write parameters without opening the editor. This is what keeps automation,
generic inspector control, and modulation working.

## State save/restore

Configured parameter values, preset references, and saved plugin-specific
metadata that belongs to the project are **project truth**. The live mechanism
that pushes that state into a fresh instance on load is **runtime**. State
restore may fail independently (see the failure catalogue) and must not silently
corrupt project truth when it does.

## Editor window management

Editor lifecycle is runtime/UI behavior, not project truth. Opening, sizing,
focusing, or closing an editor is a runtime/UI bridge. Do not let editor
lifecycle leak into saved project truth unless explicitly designed and modeled.

Third-party plugin GUIs belong in **native windows** — do not embed native plugin
editors inside the webview UI. Default model:

- DAW UI in the webview
- plugin editor in separate native window(s)

## Audio processing

Audio-thread-sensitive processing is distinct from all GUI/scan/control concerns.
It runs on the RT path and obeys the RT rules in the body (no allocation, no
locks, no windows, no filesystem, no blocking IPC). See the body's "RT safety"
rule and the fast-path/slow-path split.

## Crash / failure isolation

A hosted plugin can crash or hang. Isolation state — which instance is in an
error state, what recovery is in flight — is **runtime** state, never project
truth. A crashing plugin must not take down the host or corrupt the saved
project. The body's rule 9 and its bundled failure catalogue carry the full
isolation expectations.
