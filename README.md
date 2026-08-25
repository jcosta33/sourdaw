<div align="center">
  <img src="./public/icon-transparent.png" alt="Sourdaw" width="160">

# Sourdaw

**An open-source DAW with a built-in agent harness.**

[App](https://app.sourdaw.studio/) · [Website](https://www.sourdaw.studio/) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Privacy](./PRIVACY.md)
</div>

Sourdaw is a digital audio workstation for Chromium-based browsers and an
Electron desktop shell. The hosted app runs at
[app.sourdaw.studio](https://app.sourdaw.studio/).

Status: active alpha. There are no versioned releases or signed installers
yet; `main` is the current source.

## Stack

- Web app: TypeScript, React, Vite, and the Web Audio API. Project state is
  an Automerge CRDT document, so undo, persistence, and collaboration share
  one write path.
- Desktop: an Electron shell over the same app, backed by Rust crates for
  native audio, DSP, CLAP plugin hosting, and I/O, plus Rust-to-WASM packages
  shipped as committed artifacts.
- Collaboration: direct WebRTC sessions, an optional authenticated WebSocket
  relay (`server/`), and native LAN discovery. These are transports, not a
  hosted Sourdaw service.
- Agent harness: accepts natural-language production goals, plans against
  application-owned tools, validates proposed actions, requires confirmation
  where risk demands it, and executes through the same project mutation and
  undo paths as the UI.

## The DAW

Arrangement, recording and editing, a mixer, routing, automation, built-in
instruments and effects, local project persistence, and direct collaboration.
The desktop app also hosts CLAP plugins. VST® 3 is unsupported.

## The agent harness

The harness works on tracks and clips, MIDI, devices, routing, automation,
mix changes, generation, and analysis. Voice input gives the prompt bar
another way in.

Intelligence surfaces include generative MIDI and patterns, Basic Pitch
audio-to-MIDI conversion, desktop-native Whisper dictation, and mix analysis
for frequency and level feedback. Hosted language-model routes are Anthropic,
OpenAI, and OpenAI-compatible providers through the desktop native gateway.

WebLLM's browser-local runtime exists in the source, but its model artifacts
are not admitted for the current source build. It is not an enabled product
path yet.

## Repository layout

- `src/modules/` — product code, split by domain.
- `src/app/` — composition root and dependency registration.
- `electron/` — desktop shell: main process, preload bridge, IPC router.
- `crates/` — Rust: audio engine, DSP, plugin host, I/O, WASM packages.
- `server/` — optional collaboration relay.
- `docs/` — developer documentation; `docs/manual/` holds the user manual.

## Run it

### Prerequisites

- Node.js `>=24.15.0 <25`
- pnpm `11.6.0`
- Rust nightly `nightly-2026-04-14` for desktop and native work

### Browser app

```sh
pnpm install
pnpm dev
```

Build it with `pnpm build`.

The optional collaboration relay has its own dependencies:

```sh
npm --prefix server ci --include=dev
```

### Desktop app

```sh
pnpm install
pnpm desktop:build
```

This creates a local macOS arm64 package. It is ad-hoc signed, not
distribution signed, notarized, published, or updated automatically.

## Licensing

Sourdaw-owned source is licensed under [Apache-2.0](./LICENSE). Dependencies,
samples, model weights, and other third-party material retain their own
terms; see the [third-party notices](./public/legal/THIRD-PARTY-NOTICES.md).

## Read next

- [Developer documentation](./docs/README.md)
- [AI stack architecture](./docs/architecture/09-ai-stack.md)
- [Release proof](./docs/release.md)
- [User manual](./docs/manual/README.md)
