# WorkspaceShell module — Agent Guidelines

Top-level DAW application shell layout, dockable and collapsible panels, workspace modes, active editing tools and spring-loaded tool swapping, zoom operations, desktop window chrome IPC, and modal dialog dispatch; does not own timeline arrangement data (Arrangement), mixer routing DSP (MixerConsole), or project document persistence (Project).

## Public Contract Surface

- `useCases`:
    - **Panels & Visibility**: `toggleMixer`, `toggleInspector`, `toggleSidebar`, `toggleTrackList`, `toggleChatPanel`, `toggleBranchManager`, `toggleAutomationPanel`, `toggleVirtualKeyboard`, `toggleWorkspaceMode`, `setWorkspaceMode`, `openInspector`, `closeCommandPalette`, `closeCollaborationPanel`, `closeUndoHistory`, `closeScratchPad`, `setSoloMode`, `setVirtualKeyboardOctave`, `setVirtualKeyboardVelocity`, `cycleChannelStripWidth`, `setSessionViewWidth`, `setTrackListWidth`, `showAutomationPanel`, `showDevicePanelForType`.
    - **Zoom & Navigation**: `zoomToFit`, `zoomToSelection`, `cycleAutomationVisibility`, `onZoomToFit`, `onZoomToSelection`, `onScrollToPlayhead`.
    - **Editing Tools & Shell State**: `setEditingTool`, `startToolSwap`, `finishToolSwap`, `toggleRippleEditing`, `updateWorkspaceState`, `dismissAlphaNotice`, `TOOL_SHORTCUTS`.
    - **Dialogs & Window Chrome**: `openExportDialog`, `openPreferencesDialog`, `windowChromeControls`, `setWorkspaceEventBus`.
    - **Handlers**: `getWorkspaceHandlers`, `getScratchPadHandlers`.
- `stores`: `workspaceStore` (`WorkspaceState`, `EditingTool`, `defaultWorkspaceState`), `toolSwapStore`, `alphaNoticeStore`.
- `presentations/views`: `AppShell`, `WorkspaceAppBoundary`, `WorkspaceMobileGate`, `WorkspaceProjectLoadingFallback`, `WorkspaceRouteView`.
- Shell-private presentation: `presentations/hooks/useProjectMutationRefusal` (`ProjectMutationRefusal`, `deriveProjectMutationRefusal`) and `presentations/components/ProjectMutationRefusedBanner`. Not exported across modules — the shell is the only surface that renders them.
- `events`: `ShowDevicePanelPayload`, `NotifyPayload`, `ConfirmPayload`, `PromptPayload`, `ZoomToSelectionPayload`, `ToggleVoiceCommandPayload`, `ImportMidiPayload`, MIDI payload types.
- Handlers: `getWorkspaceHandlers`, `getScratchPadHandlers`.

## Key Subsystems

- **App Layout & Panel Toggles**: `presentations/views/AppShell.tsx` coordinates main multi-pane workspace layout (sidebar, inspector, mixer, timeline, session grid).
- **Editing Tool & Spring-Loaded Swaps**: `stores/toolSwapStore.ts` tracks active tools (`select`, `cut`, `draw`, `erase`, `smart`) and handles temporary modifier/key-hold tool switching.
- **Window Chrome Integration**: `useCases/windowChrome.ts` interfaces with native desktop Electron window framing (minimize, maximize, close).
- **Workspace Event Bus**: Inter-panel UI event routing for confirmation dialogs, notifications, and device panel triggers (`useCases/workspaceEventBus.ts`).

## Invariants & Traps

- Spring-loaded tool swaps must pair every `startToolSwap` with a guaranteed `finishToolSwap` on key release to prevent persistent tool lockup.
- Workspace layout and panel states are client UI session state — never serialize workspace layout directly into project CRDT documents.
- The mutation-refusal banner is not a dialog: keep it out of `anyDialogOpen` and out of the shell's `inert` condition. Every route out of a refusal — the assistant panel, the production brief, undo, the launch screen — lives inside the workspace it sits above, so covering the workspace would trap the user in the state the banner is explaining.
- The banner never derives a refusal itself. `deriveProjectMutationRefusal` reads the same repair store the dispatch gate reads and calls `getProjectScopedBriefLock` for the brief gate, so the banner and the gate cannot disagree about why an edit was refused.

## Verification

```bash
pnpm vitest run src/modules/WorkspaceShell
```
