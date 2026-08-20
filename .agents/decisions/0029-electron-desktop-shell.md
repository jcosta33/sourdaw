---
type: adr
id: 0029
title: The desktop shell is Electron over a shell-agnostic native crate
status: accepted
date: 2026-08-19
owner: The Sourdaw team
sources:
    - .agents/decisions/0012-neither-target-degrades-the-other.md
    - .agents/decisions/0027-windows-device-layer-iaudioclient3.md
    - docs/architecture/02-rust-backend.md
---

# 0029 — The desktop shell is Electron over a shell-agnostic native crate

**Accepted 2026-08-19.** Resolves the desktop-packaging deferral recorded in ADR 0012. Records the
shell decision the "Electron shell & native audio backend" campaign executed: the Tauri v2 shell is
removed, and the Electron shell in `electron/` is the one desktop shell.

## Context

ADR 0012 fixed the parity principle — neither target may be degraded to accommodate the other — and
deliberately left desktop packaging open. Under Tauri, the desktop webview was WKWebView on macOS,
WebView2 on Windows and WebKitGTK on Linux, so the renderer had to hold to three engines while the
web target was Chromium-only. That divergence was the load-bearing reason WebKit feature branches
survived in a Chromium-only web product.

The campaign moved every command body out of the Tauri shell into `crates/sourdaw-native`, a crate
that names no shell: bodies take plain owned arguments, reach the host only through the seams in
`events.rs` and `host/`, and are published to Node as a napi addon. Once the bodies were
shell-agnostic, the shell itself was a thin replaceable layer, and the choice reduced to which shell
gives the DAW the strongest runtime.

## Decision

1. **Electron is the desktop shell.** The renderer is the unmodified web build served from a
   custom `app://` scheme with COOP/COEP isolation headers; the main process exposes the native
   surface over IPC (`electron/commands.ts`, `electron/router.ts`) backed by the
   `crates/sourdaw-native` addon.
2. **The native crate stays shell-agnostic.** No shell type may enter `crates/sourdaw-native`; a
   command exists as a body in the crate plus an opaque wrapper in the shell. This is what made the
   cutover possible and is what keeps the shell replaceable.
3. **The renderer seam is `src/utils/desktopBridge.ts`** over the `window.sourdaw` preload bridge,
   with positional arguments in addon parameter order and raw-buffer byte payloads. Frontend
   desktop I/O stays confined to module-root repositories and this adapter
   (`desktop-ipc-only-in-repositories`).
4. **Web ships unchanged.** The web target keeps Web Audio and its existing capabilities; the
   desktop engine decisions (ADR 0027 for Windows) are desktop-only concerns.

## Consequences

- Every shipped renderer — web and desktop — is now Chromium. The engine-divergence rationale for
  WebKit-only branches is gone; each such branch is now judged purely under ADR 0012's test ("does
  it cap a target or hide a downgrade?") with no packaging option left that could need it.
- ADR 0012's parity principle is untouched; only its packaging deferral is resolved.
- The Electron shell carries the security posture the Tauri capability file used to: the
  exposed/denied command partition in `electron/commands.ts` (enforced against the addon surface by
  `electron/__tests__/commands.spec.ts`), the production CSP and isolation headers in
  `electron/protocol.ts`, flipped fuses and ad-hoc signing at package time.
- A future shell change repeats this shape: relocate nothing, wrap the same crate.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Stay on Tauri v2 | Three webview engines for one Chromium-only product; plugin editor hosting and binary IPC fought the shell; the parity burden of ADR 0012 was being paid continuously for no product gain. |
| Rust-native shell (no web renderer) | Discards the entire product UI; a rewrite, not a packaging choice. |
| Keep both shells | Two security surfaces and two IPC transports to hold in parity forever; the capability file and the command partition would drift. |

## Status

accepted
