# Sourdaw

Sourdaw is an open-source, browser-first digital audio workstation. It is active
development software, not a finished commercial release. There are no published
releases yet; `main` is the current source.

The project is licensed under [Apache-2.0](./LICENSE).

## What works here

- **Browser:** the React/Vite DAW, Web Audio, WASM DSP, local project persistence,
  and selected local AI features.
- **Desktop:** an Electron shell with the Rust native addon. The current local
  packaging target is macOS arm64.
- **Collaboration:** direct WebRTC sessions, an optional authenticated WebSocket
  relay, and native LAN discovery. These are collaboration transports, not a
  hosted Sourdaw service.
- **Plugins:** CLAP scanning and hosting on desktop. VST3 is unsupported.

## Prerequisites

- Node.js `>=24.15.0 <25`
- pnpm `11.6.0`
- Rust nightly `nightly-2026-04-14` for desktop and native work

## Run the browser app

```sh
pnpm install
pnpm dev
```

Build the browser app with `pnpm build`.

## Build the desktop app

```sh
pnpm install
pnpm desktop:build
```

That creates a local macOS arm64 package. It is ad-hoc signed, not distribution
signed, notarized, published, or updated automatically.

## More

- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Privacy](./PRIVACY.md)
- [Developer documentation](./docs/README.md)
- [User manual](./docs/manual/README.md)
