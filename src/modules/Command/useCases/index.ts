// Command/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { describeAction } from './actionLabels';

export type { AppAction, ActionHandler } from './commandQueries';
export { generateGroupId } from './commandQueries';

export { executeAppAction } from './executeAppAction';
export type { ExecuteOptions } from './executeAppAction';

export { getMacroHandlers } from './getMacroHandlers';
export { getUndoTreeHandlers } from './getUndoTreeHandlers';

// `playMacro` / `deleteMacro` are invoked through `executeAppAction` (they have
// `playMacro` / `deleteMacro` AppActions + handlers), so their use-case re-exports
// were redundant cross-module entry points that bypassed dispatch — removed.
// `renameMacro` is still re-exported: it has no handler yet, so MacrosPanel calls
// the use-case directly (a `renameMacro` AppAction now exists in the union for the
// future handler; see follow-up to wire it and route MacrosPanel through dispatch).
export { renameMacro } from './macro/management/renameMacro';

export { startMacroRecording } from './macro/recording/startMacroRecording';
export { stopMacroRecording } from './macro/recording/stopMacroRecording';
export type { Macro } from './macro/recording/stopMacroRecording';

export { undo, redo } from './undoRedo';
export { commitPitchEditCommand } from './pitch/commitPitchEdit';
