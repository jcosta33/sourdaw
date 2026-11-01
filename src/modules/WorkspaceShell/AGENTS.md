# WorkspaceShell module — Agent Guidelines

Top-level DAW application shell layout, dockable and collapsible panels, workspace modes, active editing tools and spring-loaded tool swapping, zoom operations, desktop window chrome IPC, and modal dialog dispatch; does not own timeline arrangement data (Arrangement), mixer routing DSP (MixerConsole), or project document persistence (Project).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `events/index.ts`, `presentations/views/index.ts`.

## Key Subsystems

- **App Layout & Panel Toggles**: `presentations/views/AppShell.tsx` coordinates main multi-pane workspace layout (sidebar, inspector, mixer, timeline, session grid).
- **Editing Tool & Spring-Loaded Swaps**: `stores/toolSwapStore.ts` tracks active tools (`select`, `cut`, `draw`, `erase`, `smart`) and handles temporary modifier/key-hold tool switching.
- **Agent Workspace**: `presentations/views/AgentWorkspace.tsx` composes AiRuntime's agent run, approval and provider-route projections into one bottom-dock surface; it owns no store of its own and mutates only through AiRuntime use cases. Its Reference section (`AgentReferenceSection`, driven by `useAgentReferenceController` and mounted through the `AgentReferenceControls` view) loads and clears the user's comparison reference through `loadAgentReference` and `clearAgentReference`, shows the stored name and integrated loudness, and shows a load failure inline; it keeps only the last load outcome, never the reference.
- **Window Chrome Integration**: `useCases/windowChrome.ts` interfaces with native desktop Electron window framing (minimize, maximize, close).
- **Workspace Event Bus**: Inter-panel UI event routing for confirmation dialogs, notifications, and device panel triggers (`useCases/workspaceEventBus.ts`).

## Invariants & Traps

- Spring-loaded tool swaps must pair every `startToolSwap` with a guaranteed `finishToolSwap` on key release to prevent persistent tool lockup.
- Workspace layout and panel states are client UI session state — never serialize workspace layout directly into project CRDT documents.
- The mutation-refusal banner is not a dialog: keep it out of `anyDialogOpen` and out of the shell's `inert` condition. Every route out of a refusal — the assistant panel, the production brief, undo, the launch screen — lives inside the workspace it sits above, so covering the workspace would trap the user in the state the banner is explaining.
- The banner never derives a refusal itself. `deriveProjectMutationRefusal` reads the same repair store the dispatch gate reads and calls `getProjectScopedBriefLock` for the brief gate, so the banner and the gate cannot disagree about why an edit was refused.
- While mounted, `VirtualKeyboard` owns the computer keyboard through window capture-phase listeners, not panel focus: musical keys play anywhere and every other unmodified key is swallowed before any other listener. Cmd/Ctrl chords (but not AltGr, which Chromium reports as Ctrl+Alt), Tab, text fields, selects and dialogs, menus and open selects pass through, and a focused control, canvas editor or always-mounted listbox keeps the keys it handles natively (a listbox yields only its navigation and activation keys, so musical keys and Esc still work beside it). The keyboard is the lowest Escape owner: Esc closes it only on a plain, non-repeat press and only when no dialog, menu, popup or drag is open, because those dismiss first; a held plain Esc's repeats are consumed without closing, and a modified Esc such as the Shift+Esc MIDI panic, repeat or not, passes through to the global shortcut layer. Do not gate this inside individual shortcut listeners; that splits the lock across modules and leaves other window listeners firing.
- `useProjectMutationRefusal` and `ProjectMutationRefusedBanner` are shell-private presentation: they are not exported across modules, and the shell is the only surface that renders them.
- Tool keys shown to the user (cheat sheet rows, palette hints, tool tooltips) derive from the default tool key maps `handleKeydown` reads, through `getToolShortcutHint`, `getToolForKeyPress` and `TOOL_LABELS`, so a default tool key cannot drift from the help. Never write a tool key by hand: `A` is the automation-visibility shortcut, not a tool key. A user remap of a store shortcut onto a tool letter is matched first and shadows the tool; the help does not show that.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

```bash
pnpm guard --profile focused -- pnpm test:run <changed-spec>
```
