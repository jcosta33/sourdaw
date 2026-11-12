# Preferences module — Agent Guidelines

Application-wide user preferences (audio settings, MIDI configuration, appearance/theme, track/minimap default sizing, grid snap, AI options, performance settings), local storage persistence, and the preferences settings dialog; does not own project-specific settings (Project) or shortcut keybinding stores (CommandInterface).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `events/index.ts`, `presentations/views/index.ts`.

## Key Subsystems

- **Preferences Store & Validation**: `stores/preferencesStore.ts` uses `createStore` for reactive access backed by the client-local `sourdaw-preferences` key. The same file validates persisted fields, including the last-used Elastic transient sensitivity, and supplies defaults for absent or corrupt values.
- **Preferences Dialog**: Tabbed configuration view (`presentations/views/PreferencesDialog.tsx`) aggregating `GeneralSection`, `AppearanceSection`, `LayoutSection`, `MidiSection`, `AiSection`, `PerformanceSection`, and `ShortcutsSection`.

## Invariants & Traps

- Preferences are client-local and application-global — they must never be saved into project document files or synced across collaboration peers.
- Storage writes must safely catch quota exceeded errors and corrupted JSON, falling back cleanly to `defaultPreferences`.
- Saving a hosted provider while the AI execution backend is Automatic asks once whether to select it, because Automatic never sends a request to a hosted provider and the saved provider would otherwise go unused without a word. Only Yes changes the selector. The provider's identity (its kind, or an OpenAI-compatible endpoint by its normalized base URL; never a model, key or anything secret) is recorded in `hostedBackendQuestionAsked` when the question is shown, so dismissing it or closing Settings counts as no and a later save of the same provider does not ask again; Yes removes it, since the backend selection lasts one session and Automatic returns at the next launch.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

```bash
pnpm guard --profile focused -- pnpm test:run <changed-spec>
```
