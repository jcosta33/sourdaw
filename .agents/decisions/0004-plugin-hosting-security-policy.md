---
type: adr
id: 0004
title: Make native plugin-hosting security policy explicit
status: accepted
date: 2026-06-28
owner: The Sourdaw team
sources:
  - .agents/specs/plugin-hosting-clap/spec.md
---

# 0004 — Make native plugin-hosting security policy explicit

## Context

The native security hardening task narrowed renderer capabilities, shell
exposure, model integrity, and raw path command surfaces. Two plugin-hosting
security choices remain policy-level rather than code-only:

- whether plugin scanning may accept arbitrary renderer-provided directories, or
  only platform defaults plus native/user-granted custom roots;
- which macOS entitlements are required for third-party native plugin hosting,
  and whether broad entitlements are limited to plugin-host-capable builds.

## Decision

Native plugin hosting uses explicit security policy:

1. Plugin scan roots are native-owned. Built-in platform plugin directories may
   be scanned by default. Custom roots require a native/user-granted directory
   choice or stored preference; renderer-provided raw path strings are not
   enough authority by themselves.
2. Broad macOS plugin-host entitlements must be tied to a plugin-hosting build
   or feature policy. A distribution target that does not need third-party
   native plugin loading should not inherit disabled sandbox/library-validation
   posture by accident.
3. The Tauri command layer exposes scan/editor requests as explicit DTOs and
   delegates policy to native plugin-host services. It does not own plugin-host
   domain rules or leak runtime handles over IPC.

## Non-goals

- Do not remove existing plugin-hosting entitlements before replacement scan and
  editor flows are implemented and verified.
- Do not define a full product-permission UX for custom plugin folders here.
- Do not make renderer-provided filesystem paths sufficient authority for native
  plugin scanning.

## Open questions

- Which custom-root grant mechanism should the product expose: native folder
  picker, settings preference, signed policy file, or a combination?
- Which release channels should include broad plugin-hosting entitlements by
  default?
- How should scan-root grants be revoked and reflected in project/plugin state?

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep accepting arbitrary scan-root strings from the renderer | It reopens the raw-path command surface that the security hardening task narrowed elsewhere. |
| Remove broad macOS entitlements immediately | It may break plugin hosting before the runtime/editor policy is implemented and tested. |
| Keep all broad entitlements globally forever | It makes plugin-hosting risk the default shell posture even when a build or user flow does not need it. |

## Consequences

- Positive: future scan/editor implementation has a named policy instead of
  rediscovering the same security question during review.
- Negative: custom plugin folder UX needs an explicit grant/preference flow
  rather than accepting any renderer string.
- Neutral: existing hardening remains valid; this ADR governs the plugin-host
  residue left intentionally out of that narrow task.

## Status

accepted

Reviewed at the Electron cutover (ADR 0029, 2026-08-19): the policy stands
unchanged. Decision item 3's "Tauri command layer" is now the native command
layer in `crates/sourdaw-native` fronted by the Electron IPC surface
(`electron/commands.ts`); scan-root authority and DTO-only exposure are
shell-independent and carried over verbatim. The packaged entitlements
narrowed at the cutover — `allow-jit` replaces
`allow-unsigned-executable-memory` and `allow-dyld-environment-variables` is
dropped — as recorded in `build/entitlements.mac.plist`; the plugin-hosting
posture this ADR governs is otherwise unchanged.

## Follow-up work

Future implementation work should move scan-root authority into native-owned
grants or preferences and make broad plugin-hosting entitlements
release-channel explicit.

## Affected requirements

- `SPEC-plugin-hosting-clap#AC-001` — loaded plugin identity depends on trusted scan metadata.
- `SPEC-plugin-hosting-clap#AC-007` — native editor windows require platform entitlement policy.
