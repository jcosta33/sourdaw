<div align="center">
  <img src="./public/icon-transparent.png" alt="Sourdaw" width="160">

# Sourdaw

**A full DAW with its own agent harness, running wherever Chromium does.**

[Website](https://www.sourdaw.studio/) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Privacy](./PRIVACY.md)
</div>

Sourdaw is an open-source digital audio workstation for the browser and an
Electron desktop shell. Same DAW, different door. It is active alpha software,
not a finished commercial release; there are no published releases yet, and
`main` is the current source.

The useful comparison is **Cursor for music production, except Sourdaw did not
fork an editor; its DAW and harness were built together from scratch.**

## The DAW

There is a serious DAW underneath the agent layer: arrangement,
recording/editing, a mixer, routing, automation, built-in instruments and
effects, local project persistence, and direct collaboration. The desktop app
also hosts CLAP plugins. VST® 3 is unsupported.

Collaboration uses direct WebRTC sessions, an optional authenticated WebSocket
relay, and native LAN discovery. These are collaboration transports, not a
hosted Sourdaw service.

## The harness

The agent is not a chatbot taped to the window. It is wired into the
workstation's command surface.

The harness reads project context, accepts natural-language production goals,
plans against application-owned tools, validates proposed actions, requires
confirmation where risk demands it, and executes through the same project
mutation and undo paths as the UI. It can work on tracks and clips, MIDI,
devices, routing, automation, mix changes, generation, and analysis. Voice
input gives the prompt bar another way in.

## AI surfaces

Current intelligence surfaces include:

- Generative MIDI and patterns for melodies, chords, drums, fills, and
  variations.
- Basic Pitch audio-to-MIDI conversion.
- Desktop-native Whisper dictation for voice input.
- Mix analysis for frequency and level feedback.

Hosted language-model routes are Anthropic, OpenAI, and OpenAI-compatible
providers through the desktop native gateway.

WebLLM's browser-local runtime exists in the source, but its model artifacts
are not admitted for the current source build. It is not an enabled product
path yet.

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

This creates a local macOS arm64 package. It is ad-hoc signed, not distribution
signed, notarized, published, or updated automatically.

## Licensing

Sourdaw-owned source is licensed under [Apache-2.0](./LICENSE). Dependencies,
samples, model weights, and other third-party material retain their own terms;
see the [third-party notices](./public/legal/THIRD-PARTY-NOTICES.md).

## Read next

- [Developer documentation](./docs/README.md)
- [AI stack architecture](./docs/architecture/09-ai-stack.md)
- [Release proof](./docs/release.md)
- [User manual](./docs/manual/README.md)
