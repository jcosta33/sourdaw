# CommandInterface module — Agent Guidelines

Interactive command palette UI, keyboard shortcut mappings and rebindings, command catalog discovery/search, and global keyboard shortcut routing; does not own the command execution kernel or undo history (Command).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `presentations/views/index.ts`.

## Key Subsystems

- **Command Catalog & Search**: Categorized command lists in `useCases/commands/*` (Audio, Midi, Clip, Edit, View, Transport, etc.) indexed and searched via `models/commandSearch.ts`.
- **Shortcut Store & Storage**: `stores/shortcutStore.ts` persists user keybindings to `localStorage` with fallback defaults. `useCases/findShortcutConflicts.ts` finds every other binding that holds a combo, and `setShortcutMapping` moves a reassigned combo off them.
- **Global Keybinding Hook**: `presentations/views/keyboardShortcutsContract.ts` listens for global hotkeys, handling macOS/Windows modifier normalization and suppressing events in text inputs.

## Invariants & Traps

- All palette commands and keyboard shortcuts must trigger actions through `Command/executeAppAction` rather than calling module use cases or mutating stores directly.
- Global key handlers must strictly ignore keydown events originating from `INPUT`, `TEXTAREA`, or `[contenteditable]` elements to prevent stealing user typing.
- A shortcut key is `resolveShortcutKey`'s answer, never raw `KeyboardEvent.key`: Alt, and Shift on a non-letter, change the produced character (Option+D is `∂`, Shift+1 is `!`), so those presses read the physical key through the keyboard layout map. The dispatch adapter and the Preferences capture both use it, so a captured combo fires on the press that captured it.
- An armed Loop Station resolves pad bindings before global ones that share their keys; the shipped pad defaults rely on this (R plays a pad rather than recording). A user rebind still treats every definition holding the combo as a holder, pads included, and moves the key off it on confirm, because a pad rebound onto a global key (Cmd+C) would silently take it while armed.
- Custom mappings live under `sourdaw-shortcut-bindings` and are never rewritten on load. Mappings saved before physical-key resolution, under the legacy `sourdaw-shortcuts` key, named the character their modifier produced (`alt+∂`, `shift+!`); they are migrated once, through the US Shift and macOS Option tables, as the seed of the current key, and ignored once it exists. Migrating current mappings would misread valid non-US captures (AZERTY `shift+&` is Shift+Digit1, not Shift+7). Legacy characters from other layouts are not recognised and stay as stored.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

```bash
pnpm guard --profile focused -- pnpm test:run <changed-spec>
```
