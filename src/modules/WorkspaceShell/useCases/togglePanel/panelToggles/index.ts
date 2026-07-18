/**
 * Panel toggle use cases — barrel.
 *
 * Each toggle/setter lives in its own per-use-case file beside this barrel
 * (the form callers import directly, e.g.
 * `panelToggles/clearClipSelection`). This index re-exports every one of
 * them so the package path
 * `#/modules/WorkspaceShell/useCases/togglePanel/panelToggles` resolves the same
 * symbols. There is exactly one body per function — this file declares none.
 *
 * The functions split into three structural groups:
 *
 *   1. **setters** — write a value unconditionally. No need to read
 *      current state. (`openMixer`, `selectClip`, `setSnapValue`, …)
 *   2. **boolean toggles** — read current state, write the negation of
 *      a boolean field. (`toggleMixer`, `toggleSidebar`, …)
 *   3. **stateful transitions** — read current state and apply a
 *      non-trivial transform (`cycleChannelStripWidth`,
 *      `toggleTimeDisplayMode`, `toggleWorkspaceMode`,
 *      `toggleClipInSelection`).
 */

// ── Group 1: unconditional setters ──────────────────────────────────────
export { closeBranchManager } from './closeBranchManager';
export { closeCollaborationPanel } from './closeCollaborationPanel';
export { closeCommandPalette } from './closeCommandPalette';
export { closeScratchPad } from './closeScratchPad';
export { closeUndoHistory } from './closeUndoHistory';
export { openInspector } from './openInspector';
export { openMixer } from './openMixer';
export { openVirtualKeyboard } from './openVirtualKeyboard';
export { setSnapValue } from './setSnapValue';
export { setSoloMode } from './setSoloMode';
export { setTrackListWidth } from './setTrackListWidth';
export { setVirtualKeyboardOctave } from './setVirtualKeyboardOctave';
export { setVirtualKeyboardVelocity } from './setVirtualKeyboardVelocity';
export { setSessionViewWidth } from './setSessionViewWidth';

// ── Group 2: boolean toggles ────────────────────────────────────────────
export { toggleAutomationPanel } from './toggleAutomationPanel';
export { toggleBranchManager } from './toggleBranchManager';
export { toggleChatPanel } from './toggleChatPanel';
export { toggleCollaborationPanel } from './toggleCollaborationPanel';
export { toggleCommandPalette } from './toggleCommandPalette';
export { toggleInspector } from './toggleInspector';
export { toggleMixer } from './toggleMixer';
export { toggleSidebar } from './toggleSidebar';
export { toggleTrackList } from './toggleTrackList';
export { toggleUndoHistory } from './toggleUndoHistory';
export { toggleVirtualKeyboard } from './toggleVirtualKeyboard';
export { toggleDualView } from './toggleDualView';

// ── Group 3: stateful transitions ───────────────────────────────────────
export { cycleChannelStripWidth } from './cycleChannelStripWidth';
export { toggleTimeDisplayMode } from './toggleTimeDisplayMode';
export { toggleWorkspaceMode } from './toggleWorkspaceMode';
