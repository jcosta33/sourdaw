// Command/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { describeAction } from './actionLabels';

export type { AppAction, ActionHandler, HandlerDescribeResult } from './commandQueries';
export { generateGroupId } from './commandQueries';

export { executeAppAction } from './executeAppAction';
export type { ExecuteOptions } from './executeAppAction';

export { getMacroHandlers } from './getMacroHandlers';
export { getUndoTreeHandlers } from './getUndoTreeHandlers';

// `playMacro` / `deleteMacro` / `renameMacro` are invoked through
// `executeAppAction` (each has an AppAction + a handler registered in
// `getMacroHandlers`), so their use-case re-exports would be redundant
// cross-module entry points that bypass dispatch — not re-exported.

export { startMacroRecording } from './macro/recording/startMacroRecording';
export { stopMacroRecording } from './macro/recording/stopMacroRecording';
export type { Macro } from './macro/recording/stopMacroRecording';

export { undo, redo } from './undoRedo';
export { revertActionGroup } from './revertActionGroup';
export { commitPitchEditCommand } from './pitch/commitPitchEdit';

export { setShortcutMapping } from './setShortcutMapping';
export { resetShortcutMappings } from './resetShortcutMappings';
