---
type: bug
id: BUG-native-lan-browsing-untracked-threads
title: Native LAN discovery browsing can spawn untracked mDNS threads
status: fixed
owner: The Sourdaw team
sources:
  - .agents/findings/remaining-surface-audit-2026-06-27.md
  - SPEC-collaboration-discovery
---

# Bug: Native LAN discovery browsing can spawn untracked mDNS threads

## Symptom

`collab_start_browsing` can be called repeatedly. Each call invokes `LanDiscovery::start_browsing`, which calls `MdnsService::browse` and spawns a receiver thread. There is no stored thread handle, no browser token, and no `collab_stop_browsing` command analogous to `collab_stop_advertising`.

## Reproduction

Inspect the Tauri command and discovery implementation:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/collab.rs:130:pub fn collab_stop_advertising(state: State<'_, CollabState>) -> Result<bool, String> {
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/collab.rs:139:pub fn collab_start_browsing(state: State<'_, CollabState>) -> Result<bool, String> {
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/collab.rs:142:    discovery.start_browsing()?;
/Users/josecosta/dev/sourdaw/crates/daw-collab/src/discovery.rs:95:    pub fn start_browsing(&self) -> Result<(), String> {
/Users/josecosta/dev/sourdaw/crates/daw-collab/src/discovery.rs:103:        std::thread::spawn(move || {
```

**Expected:** LAN browsing is idempotent or has a stop lifecycle that tears down the active browser.
**Actual:** repeated start calls can accumulate receiver threads with no owner visible to command state.
**Conditions:** Source inspection on 2026-06-27.

## Root cause

Advertising lifecycle state is tracked, but browsing lifecycle state is fire-and-forget. The receiver thread is launched without an owner that can prevent duplicate starts or stop the loop.

## Affected requirements

- `SPEC-collaboration-discovery` - nearby-session discovery should be lifecycle-safe and repeatable.
- Collaboration reliability - repeated toggles or view remounts should not leak native discovery work.
