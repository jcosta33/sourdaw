# Documentation

Use this page as the route map.

- **Using Sourdaw:** read the [user manual](./manual/README.md).
- **Contributing:** start with the root [README](../README.md) and
  [contribution guide](../CONTRIBUTING.md).
- **Project policy:** [security](../SECURITY.md) and [privacy](../PRIVACY.md).
- **System shape:** [system architecture](./architecture/01-system.md),
  [Rust backend](./architecture/02-rust-backend.md), and
  [TypeScript modules](./architecture/03-typescript-module.md).
- **Plugins and audio:** [plugin hosting security](./architecture/04-plugin-hosting-security.md),
  [WASM DSP](./architecture/07-wasm-dsp-pipeline.md), and the
  [device authoring guide](./architecture/08-device-authoring.md).
- **State and collaboration:** [CRDT and collaboration](./architecture/06-crdt-collaboration.md).
- **AI and desktop:** [AI stack](./architecture/09-ai-stack.md) and
  [desktop packaging](./architecture/10-desktop-packaging.md).
- **Engineering practice:** [testing](./06-testing.md),
  [conventions](./07-conventions.md), [events](./04-events.md), and
  [dependency injection](./01-dependency-injection.md).

The architecture pages describe current implementation boundaries. They do not
turn an unfinished feature into a supported release feature. That would be a
surprisingly expensive Markdown bug.
