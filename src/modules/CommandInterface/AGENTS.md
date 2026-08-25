# CommandInterface module — Agent Guidelines

Interactive command palette UI, keyboard shortcut mappings and rebindings, command catalog discovery/search, and global keyboard shortcut routing; does not own the command execution kernel or undo history (Command).

## Public Contract Surface

- `useCases`: `setShortcutMapping`, `resetShortcutMappings`.
- `stores`: `shortcutStore` (`ShortcutStoreState`, `ShortcutDefinition`, `ShortcutAction`).
- `presentations/views`: `CommandPalette`, `useGlobalKeyboardShortcuts`.

## Key Subsystems

- **Command Catalog & Search**: Categorized command lists in `useCases/commands/*` (Audio, Midi, Clip, Edit, View, Transport, etc.) indexed and searched via `services/commandSearch.ts`.
- **Shortcut Store & Storage**: `stores/shortcutStore.ts` persists user keybindings to `localStorage` with fallback defaults and conflict detection.
- **Global Keybinding Hook**: `presentations/views/keyboardShortcutsContract.ts` listens for global hotkeys, handling macOS/Windows modifier normalization and suppressing events in text inputs.

## Invariants & Traps

- All palette commands and keyboard shortcuts must trigger actions through `Command/executeAppAction` rather than calling module use cases or mutating stores directly.
- Global key handlers must strictly ignore keydown events originating from `INPUT`, `TEXTAREA`, or `[contenteditable]` elements to prevent stealing user typing.

## Verification

```bash
pnpm vitest run src/modules/CommandInterface
```
