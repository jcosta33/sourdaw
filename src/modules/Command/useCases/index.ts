// Command/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { describeAction } from './actionLabels';

export type { AppAction } from './commandQueries';
export { generateGroupId } from './commandQueries';

export { executeAppAction } from './executeAppAction';
export type { ExecuteOptions } from './executeAppAction';

export { getMacroHandlers } from './getMacroHandlers';
export { getUndoTreeHandlers } from './getUndoTreeHandlers';

export { deleteMacro } from './macro/management/deleteMacro';
export { renameMacro } from './macro/management/renameMacro';

export { playMacro } from './macro/playback';

export { startMacroRecording } from './macro/recording/startMacroRecording';
export { stopMacroRecording } from './macro/recording/stopMacroRecording';
export type { Macro } from './macro/recording/stopMacroRecording';

export { undo, redo } from './undoRedo';
export { commitPitchEditCommand } from './pitch/commitPitchEdit';
