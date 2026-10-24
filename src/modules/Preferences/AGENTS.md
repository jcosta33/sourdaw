# Preferences module — Agent Guidelines

Application-wide user preferences (audio settings, MIDI configuration, appearance/theme, track/minimap default sizing, grid snap, AI options, performance settings), local storage persistence, and the preferences settings dialog; does not own project-specific settings (Project) or shortcut keybinding stores (CommandInterface).

## Public Contract Surface

- `useCases`: `updatePreferences`, `resetPreferences`, `setTrackHeight`, `setTimelineMinimapHeight`, `gridSnapBeats`, `defaultPreferences`, `TRACK_HEIGHT_VALUES`.
- `stores`: `preferencesStore` (`Preferences`).
- `presentations/views`: `PreferencesDialog`.

## Key Subsystems

- **Preferences Store & Validation**: `stores/preferencesStore.ts` uses `createStore` for reactive access backed by the client-local `sourdaw-preferences` key. The same file validates persisted fields, including the last-used Elastic transient sensitivity, and supplies defaults for absent or corrupt values.
- **Preferences Dialog**: Tabbed configuration view (`presentations/views/PreferencesDialog.tsx`) aggregating `GeneralSection`, `AppearanceSection`, `LayoutSection`, `MidiSection`, `AiSection`, `PerformanceSection`, and `ShortcutsSection`.

## Invariants & Traps

- Preferences are client-local and application-global — they must never be saved into project document files or synced across collaboration peers.
- Storage writes must safely catch quota exceeded errors and corrupted JSON, falling back cleanly to `defaultPreferences`.

## Verification

```bash
pnpm vitest run src/modules/Preferences
```
