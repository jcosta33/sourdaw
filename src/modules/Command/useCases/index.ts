// Command/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { ACTION_LABELS, describeAction } from './actionLabels';

export type {
    UndoEntry,
    UndoSource,
    ActionUndoEntry,
    CallbackUndoEntry,
    AppAction,
    AppActionType,
    ActionHandler,
    HandlerDescribeResult,
} from './commandQueries';
export {
    generateGroupId,
    createUndoEntry,
    createCallbackUndoEntry,
    isActionEntry,
} from './commandQueries';

export { executeAppAction } from './executeAppAction';
export type { ExecuteOptions } from './executeAppAction';

export {
    clearSolos,
    addTrack,
    duplicateTrack,
    duplicateClip,
    duplicateClipToNextBar,
    zoomTracksVertical,
} from './keyboardShortcutActions/trackShortcuts';

export { clearUndoHistory } from './clearUndoHistory';

export { deleteMacro, renameMacro } from './macro/management';

export { playMacro } from './macro/playback';

export { startMacroRecording, stopMacroRecording, recordAction } from './macro/recording';
export type { Macro } from './macro/recording';

export { pushUndoEntry } from './pushUndoEntry';

export { undo, redo, undoToIndex } from './undoRedo';
