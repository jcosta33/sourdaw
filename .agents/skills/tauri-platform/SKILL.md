---

name: tauri-platform
description: Apply when deciding whether a subsystem belongs in Web APIs or Rust/Tauri, configuring platform-specific behavior, using Tauri commands/events/channels, or dealing with macOS/Windows/Linux runtime differences. This is the authoritative skill for platform placement and shell discipline.

---

# SKILL: tauri-platform

## Purpose

This skill exists to answer a recurring systems question:

**Should this live in Web APIs or in Rust/Tauri?**

Bad placement decisions cause:

- unnecessary native complexity
- poor portability
- impossible browser implementations
- shell-owned business logic
- duplicated subsystem behavior
- fragile cross-platform behavior

This skill is not just a compatibility table.
It is a decision framework.

---

## Core principles

### 1. Use the browser when the browser is the natural owner

Prefer Web APIs when:

- the browser runtime already owns the problem
- cross-platform support is strong enough
- low-latency browser execution is viable
- the feature is tightly coupled to browser rendering/audio primitives
- moving it native would add complexity without architectural benefit

### 2. Use Rust/Tauri when the browser is fundamentally weak or absent

Prefer Rust/Tauri when:

- the browser API does not exist on key target platforms
- browser support is too fragmented to trust
- native hardware or filesystem access is required
- plugin hosting is required
- reliable platform normalization is easier natively
- browser security/capability limits make the feature impractical

### 3. Tauri is a bridge, not the business core

Tauri code should:

- expose commands
- relay events/channels
- translate payloads
- manage platform-specific integration

Tauri code should not become the owner of:

- domain rules
- feature truth
- multi-step business workflows

---

## Default placement guidance

### Prefer Web APIs for

- browser audio graph
- AudioWorklet DSP
- browser rendering surfaces
- Canvas/WebGL editor surfaces
- browser-side WASM/WAM plugins
- UI-adjacent local computation
- browser-native caches where appropriate

### Prefer Rust/Tauri for

- MIDI I/O
- native plugin hosting
- native file dialogs and filesystem workflows
- native codec handling where browser support is weak
- heavier local inference workloads
- native device/platform integration
- collaboration/network plumbing where browser reliability is inadequate
- subsystem normalization across platforms

---

## Decision process

Before placing a subsystem, ask:

1. Does the required browser API exist on all key target platforms?
2. Is the browser path reliable enough under real product constraints?
3. Is the browser already the natural runtime owner?
4. Would a native implementation meaningfully reduce risk?
5. Would moving this native thicken the shell unnecessarily?
6. Can the business logic remain independent of this placement choice?

If the subsystem can stay web-native cleanly, keep it there.
If the browser path is absent or fragile, move the capability behind a native bridge.

---

## Commands, events, and channels

### Use commands for explicit requests

Examples:

- open/save project
- open file dialog
- list MIDI ports
- load plugin metadata
- start local inference task

### Use events/channels for streamed or ongoing feedback

Examples:

- progress updates
- token streaming
- native device notifications
- metering/telemetry relays
- long-running task feedback

### Keep transport payloads explicit

Payloads crossing the bridge should be:

- serializable
- typed
- minimal
- stable enough for interop
- free of runtime handles

Do not leak native/runtime internals over IPC.

---

## Shell discipline

### Thin shell rules

The shell may:

- translate requests
- expose native capabilities
- manage platform-specific setup
- relay transport-safe state

The shell must not:

- become the domain layer
- silently own application truth
- absorb arbitrary workflow logic just because it is nearby

### Native does not mean “put everything there”

Just because Rust can do something better does not mean it belongs there.
Use native code where it is architecturally justified, not merely convenient.

---

## Platform caution

### Linux usually forces realism

Do not assume:

- WebGPU exists
- browser media APIs are equally capable
- browser-native hardware access behaves like macOS/Windows

Design fallback paths intentionally.

### Dev/prod capability parity matters

Security headers, feature flags, and environment assumptions that affect core behavior must be aligned between development and production.

### Platform differences belong behind the bridge where possible

Feature code should not be littered with platform checks unless absolutely necessary.

---

## Anti-patterns

### 1. Tauri command owns business workflow

Wrong:

- command validates domain rules, mutates truth, coordinates business logic

Right:

- command delegates into core/application/backend service logic

### 2. Browser feature used despite missing platform support

Wrong:

- choose web path while ignoring key platform gaps

Right:

- make placement based on real support and product constraints

### 3. Native side as dumping ground

Wrong:

- “put it in Rust” whenever a feature is difficult

Right:

- move only what truly belongs there

### 4. IPC payload leaks internals

Wrong:

- expose runtime handles, unstable native shapes, or implementation details across IPC

Right:

- explicit DTOs only

### 5. Shell duplication of core behavior

Wrong:

- frontend and Tauri each partially own the same workflow logic

Right:

- one clear owner, shell as transport/bridge

---

## Review checklist

Before accepting Tauri/platform code, verify:

1. Does this feature belong in Web APIs or native code?
2. Is the choice justified by actual capability and platform support?
3. Is Tauri staying a bridge rather than becoming the business core?
4. Are commands/events/channels used appropriately?
5. Are payloads typed and transport-safe?
6. Does the implementation account for macOS/Windows/Linux differences?
7. Is the shell thinner after this change, not thicker?

---
