---
type: adr
id: 0012
title: Neither target may be degraded to accommodate the other; share only at full quality
status: accepted
date: 2026-08-01
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/SURVEY-ultracode-scope.md
---

# 0012 — Neither target may be degraded to accommodate the other

## Context

A whole-application survey (`SURVEY-ultracode-scope.md`, 134 verified findings) was commissioned
under the stated premise that the target is "WASM plus the latest Chrome only", and that legacy
browser fallbacks are debt to remove.

Three independent reviewers contradicted that premise from the repository: the app also ships
through Tauri, whose webview is WKWebView on macOS, WebView2 on Windows and WebKitGTK on Linux. A
feature-detection branch that reads as dead Safari support may be the only thing keeping the desktop
build working. Sixteen findings — the whole of survey theme F, "feature-detecting or hand-rolling
what the target already provides, in front of a silent downgrade" — turn on how this is resolved,
and the survey's own programme refused to start that theme until it was settled.

Two obvious resolutions were both rejected, because both trade quality for convenience:

- Hold the web build to what the weakest shipped webview can do. This is what produced the
  capability forks and silent downgrades the survey found.
- Declare the web build authoritative and let the desktop build degrade or break. This buys
  delivery speed by writing off a target.

## Decision

**Neither target may be crippled by the other's limitations.**

Share an implementation only where **both** targets can run it at full quality. Where they cannot,
build the right thing for each. A shared lowest-common-denominator implementation, chosen because it
is quicker or simpler than building two good ones, is not acceptable on either side.

Concretely, three rules:

1. **No capability ceiling.** A platform API the web target supports is not to be avoided because a
   webview lacks it, and vice versa. If one side has the better mechanism, that side uses it.
2. **No silent downgrade.** Where the two sides genuinely diverge, the divergence is explicit,
   recorded and visible — not a `typeof X === 'undefined'` probe in front of a degraded path that
   nobody knows they are on.
3. **Leverage what each platform actually offers.** Where the desktop side can do something the
   browser cannot — native file access, real threads, a process boundary for plugin hosting — that
   is an advantage to use, not a difference to paper over. The same holds in reverse.

Desktop packaging itself is **undecided and out of scope here**. Tauri ships today; Electron,
Rust-native replacements and purpose-built WebKit fallbacks all remain open. This ADR governs how
the two targets relate, not which shell the desktop build uses.

## Non-goals

- **Not** a decision to delete every fallback. An existing fallback may remain. What it may not do
  is cap the other target, or hide a degraded path behind a probe.
- **Not** a decision to drop or to keep desktop support. That is a separate decision, deferred.
- **Not** licence to introduce an API on either side without a stated reason. "The platform ships
  it" is necessary, not sufficient.

## Consequences

- **This is more work than either single-target policy, deliberately.** Some features will need two
  real implementations where one degraded shared one would have been quicker. That is the intent.
- Theme F is unblocked, and its test changes. The question is no longer "is this fallback dead
  code?" but **"does this cap the other target, or hide a downgrade?"** A probe that does neither
  may stay.
- The WebGPU renderer selected on `'gpu' in navigator` that has no text pipeline
  (`createWebGpuRenderer.ts:264`) fails this ADR regardless of which renderer is ultimately kept:
  whichever users land on it get an objectively worse surface, silently.
- Silent downgrades behind a probe are defects on whichever side they land: a master meter reading
  hardcoded zero without `SharedArrayBuffer`, a `FinalizationRegistry` shim that would leak every
  wasm handle if it ever installed, a pointer-capture guard that turns a missing capture into a drag
  that breaks at the element edge.
- Where a shared implementation is kept, it now needs evidence that it is full-quality on **both**
  sides, not an assumption that sharing is neutral.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Treat the shipped webviews as the capability ceiling | Holds the web build to the weakest engine — the cause of the capability fork and the silent downgrades already found. |
| Declare web authoritative, let desktop degrade | Buys speed by writing off a target. Rejected explicitly: quality on one side is not currency for the other. |
| Delete every non-Chromium branch now | Forecloses packaging options that are deliberately open, and spends effort on removal that carries no product value. The cap is the defect, not the existence of the code. |
| Defer until packaging is decided | Blocks sixteen findings indefinitely, several of which harm users on both targets today. |

## Status

accepted — packaging deferral resolved by [ADR 0029](0029-electron-desktop-shell.md) (2026-08-19):
the desktop shell is Electron, so every shipped renderer is Chromium. The parity principle in this
ADR stands unchanged.

**2026-08-20 — the WebKit consumer is gone, and the branches went with it.** This ADR rejected
"delete every non-Chromium branch now" on the ground that packaging was deliberately open, and that
a branch reading as dead Safari support might be the only thing keeping the desktop build working.
ADR 0029 closed that question: WKWebView and WebKitGTK have no consumer, so a WebKit-only branch has
no reachable caller on either target and the objection no longer applies. Two rules govern what
remains, and both follow from the parity principle rather than replacing it:

- A branch reachable only in a WebKit engine is dead code. Deleting it costs neither target, so this
  ADR no longer protects it.
- A `webkit`-prefixed API is not evidence of a WebKit-only branch. Several are Chromium's own
  spelling — `webkitSpeechRecognition` and the `::-webkit-scrollbar` pseudo-elements are the live
  path on every renderer this app ships on. Each case is decided on whether Chromium dispatches or
  implements the thing, never on the prefix.

The parity principle, and the ban on a silent downgrade behind a probe, are untouched.

## Affected requirements

- Survey theme F (16 findings) is unblocked, under the revised test above.
- A future ADR choosing a desktop packaging strategy supersedes the deferral recorded here, not the
  parity principle.
