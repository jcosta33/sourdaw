---
name: tauri-platform
description: >-
  Decide whether a subsystem belongs in Web APIs or Rust/Tauri, and keep the
  shell a thin bridge. ALWAYS apply this skill when placing a subsystem on the
  web-vs-native boundary, writing or changing a Tauri command/event/channel or
  IPC payload, handling macOS/Windows/Linux runtime differences, or configuring
  platform-specific behavior — even if it
  looks like a one-line "put it in Rust" decision. Do not let a Tauri
  command own domain rules, leak runtime handles over IPC, or assume a browser
  API exists on every platform directly. Skip this skill for browser-only UI
  work with no native boundary, or core domain logic that never crosses it.
type: agent-guide
---

# Skill: tauri-platform

## Purpose

This skill answers one recurring systems question — **should this live in Web
APIs or in Rust/Tauri?** — and keeps the answer from corrupting the
architecture. Bad placement decisions cause unnecessary native complexity, poor
portability, impossible browser implementations, shell-owned business logic,
duplicated subsystem behavior, and fragile cross-platform behavior. This is not
a compatibility table; it is a decision framework plus the discipline that keeps
the shell thin.

## Core rules

### 1. Use the browser when the browser is the natural owner

Prefer Web APIs when the browser runtime already owns the problem, cross-platform
support is strong enough, low-latency browser execution is viable, the feature is
tightly coupled to browser rendering/audio primitives, or moving it native would
add complexity without architectural benefit.

_Why: web-native code is portable by default and avoids thickening the shell;
moving a problem the browser already solves into Rust buys complexity with no
architectural return._

### 2. Use Rust/Tauri when the browser is fundamentally weak or absent

Prefer Rust/Tauri when the browser API does not exist on key target platforms,
browser support is too fragmented to trust, native hardware or filesystem access
is required, plugin hosting is required, reliable platform normalization is
easier natively, or browser security/capability limits make the feature
impractical.

_Why: native is the right tool only when the browser path is genuinely absent or
untrustworthy on a target platform — capability gaps, not convenience, justify
the bridge._

### 3. Tauri is a bridge, not the business core

Tauri code should expose commands, relay events/channels, translate payloads, and
manage platform-specific integration. Tauri code must **not** become the owner of
domain rules, feature truth, or multi-step business workflows.

_Why: the moment the shell owns domain truth, the same workflow exists in two
places and portability dies — the frontend can no longer be reasoned about
without reading Rust._

### 4. Apply the placement decision process before placing a subsystem

Before placing a subsystem, ask, in order:

1. Does the required browser API exist on all key target platforms?
2. Is the browser path reliable enough under real product constraints?
3. Is the browser already the natural runtime owner?
4. Would a native implementation meaningfully reduce risk?
5. Would moving this native thicken the shell unnecessarily?
6. Can the business logic remain independent of this placement choice?

If the subsystem can stay web-native cleanly, keep it there. If the browser path
is absent or fragile, move the capability behind a native bridge.

_Why: a written order forces the placement to be justified by real capability
and product constraints, not by whichever runtime felt easier in the moment._

**Default placement guidance** (the typical answer the process above arrives at):

| Prefer Web APIs for | Prefer Rust/Tauri for |
| --- | --- |
| browser audio graph | MIDI I/O |
| AudioWorklet DSP | native plugin hosting |
| browser rendering surfaces | native file dialogs and filesystem workflows |
| Canvas/WebGL editor surfaces | native codec handling where browser support is weak |
| browser-side WASM/WAM plugins | heavier local inference workloads |
| UI-adjacent local computation | native device/platform integration |
| browser-native caches where appropriate | collaboration/network plumbing where browser reliability is inadequate |
| | subsystem normalization across platforms |

### 5. Use commands for explicit requests, events/channels for ongoing feedback

Use **commands** for explicit one-shot requests: open/save project, open file
dialog, list MIDI ports, load plugin metadata, start a local inference task. Use
**events/channels** for streamed or ongoing feedback: progress updates, token
streaming, native device notifications, metering/telemetry relays, long-running
task feedback.

_Why: a one-shot request modeled as a stream (or a stream modeled as repeated
commands) fights the transport and produces fragile, chatty IPC._

### 6. Keep transport payloads explicit and free of runtime internals

Payloads crossing the bridge must be serializable, typed, minimal, and stable
enough for interop. Do not leak native/runtime handles or implementation details
over IPC — explicit DTOs only.

_Why: a runtime handle or unstable native shape sent over IPC couples the
frontend to Rust internals and breaks the instant the native side is
refactored._

### 7. Empirically verify the FFI bridge — show, don't tell

The boundary between Rust and TypeScript is a common failure point for autonomous
agents. When modifying Tauri commands, events, or state models, you MUST
empirically verify the bridge: run `cargo test` or `cargo build` to regenerate
the updated Specta/TS bindings, then run **cmdTypecheck** on the frontend to
prove the IPC payloads align.

_Why: serialization mismatches are invisible to a mental model and only surface
at the compiler — do not trust your model of Rust-to-TS serialization; prove it
compiles. This step's output is required (see the Self-review gate)._

### 8. Keep the shell thin

The shell **may** translate requests, expose native capabilities, manage
platform-specific setup, and relay transport-safe state. The shell **must not**
become the domain layer, silently own application truth, or absorb arbitrary
workflow logic just because it is nearby. Just because Rust can do something
better does not mean it belongs there — use native code where it is
architecturally justified, not merely convenient.

_Why: "native is faster/easier here" is not an architecture argument; an
unchecked shell accretes logic until it is a second, hidden application._

### 9. Design for platform differences deliberately

Linux usually forces realism: do not assume WebGPU exists, that browser media
APIs are equally capable, or that browser-native hardware access behaves like
macOS/Windows — design fallback paths intentionally. Dev/prod capability parity
matters: security headers, feature flags, and environment assumptions that affect
core behavior must be aligned between development and production. Push platform
differences behind the bridge where possible; feature code should not be littered
with platform checks unless absolutely necessary.

_Why: silent platform assumptions ship as "works on my Mac" bugs that only appear
on a user's Linux box or in production, where they are most expensive to find._

## What does not belong

- **Domain rules, feature truth, or business workflows** — these belong in the
  frontend's DDD modules or the Rust core/application service logic the command
  delegates into, never in the Tauri command itself (rule 3).
- **Runtime handles and unstable native shapes** — these stay inside Rust; only
  explicit, serializable DTOs cross IPC (rule 6).
- **Pattern-specific architecture rules** (module boundaries, barrel discipline,
  use-case layout) — those live in the architecture skills; this skill governs
  only the web-vs-native placement and shell discipline. If installed, see
  `../architecture-violations/SKILL.md`.
- **Plugin-host internals** (scanning, instance lifecycle, RT-safe host/plugin
  comms) — this skill decides only that hosting is native; the mechanics live in
  the plugin-hosting skill. If installed, see `../plugin-hosting/SKILL.md`.

## Refuses

| Temptation | Do instead |
| --- | --- |
| Tauri command validates domain rules, mutates truth, coordinates business logic | Command delegates into core/application/backend service logic; it stays a thin entry point |
| Choose the web path while ignoring key platform gaps | Make placement based on real support and product constraints (run the rule 4 process) |
| "Put it in Rust" whenever a feature is difficult | Move only what truly belongs there — native because the browser is absent/fragile, not because it is hard |
| Expose runtime handles or implementation details across IPC | Send explicit DTOs only — serializable, typed, minimal, stable |
| Frontend and Tauri each partially own the same workflow | One clear owner; the shell is transport/bridge, never a second source of truth |
| Trust that the Rust→TS payload "looks right" | Regenerate bindings (`cargo build`/`cargo test`) and run cmdTypecheck; prove it compiles |
| Assume WebGPU / browser media / hardware access exists everywhere | Design intentional fallback paths; treat Linux as the realism floor |

## Self-review gate

Before accepting any Tauri/platform change, walk this checklist and produce the
required visible markers. **Not complete until the cmdTypecheck output (and, when
bindings changed, the `cargo build`/`cargo test` output) appears verbatim in the
review, and each box below is checked with a one-line justification.**

1. [ ] Does this feature belong in Web APIs or native code — and is the choice
   justified by actual capability and platform support, not convenience?
2. [ ] Is Tauri staying a bridge rather than becoming the business core?
3. [ ] Are commands/events/channels used appropriately (one-shot vs streamed)?
4. [ ] Are payloads typed, serializable, and free of runtime internals?
5. [ ] Does the implementation account for macOS/Windows/Linux differences and
   dev/prod parity?
6. [ ] Is the shell thinner after this change, not thicker?
7. [ ] **FFI proof:** if commands/events/state models changed, the regenerated
   Specta/TS bindings build and the frontend typechecks. Paste the verbatim tail
   of `cargo build`/`cargo test` and of cmdTypecheck. A claim without pasted
   output reads Unverified, not Pass.

> Command slots (`cmdTypecheck`, `cmdTest`, `cmdBuild`, …) resolve against the
> consuming repo's `AGENTS.md` Commands table. If a slot is missing or
> undefined, ask before declaring verification done. `cargo build` / `cargo test`
> are the project's Rust binding-generation and test commands; if your repo names
> them differently, resolve against `AGENTS.md`.
