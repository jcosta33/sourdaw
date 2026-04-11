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

export { clearSolos } from './keyboardShortcutActions/trackShortcuts/clearSolos';
export { addTrack } from './keyboardShortcutActions/trackShortcuts/addTrack';
export { duplicateTrack } from './keyboardShortcutActions/trackShortcuts/duplicateTrack';
export { duplicateClip } from './keyboardShortcutActions/trackShortcuts/duplicateClip';
export { duplicateClipToNextBar } from './keyboardShortcutActions/trackShortcuts/duplicateClipToNextBar';
export { zoomTracksVertical } from './keyboardShortcutActions/trackShortcuts/zoomTracksVertical';

export { clearUndoHistory } from './clearUndoHistory';

export { deleteMacro } from './macro/management/deleteMacro';
export { renameMacro } from './macro/management/renameMacro';

export { playMacro } from './macro/playback';

export { startMacroRecording } from './macro/recording/startMacroRecording';
export { stopMacroRecording } from './macro/recording/stopMacroRecording';
export { recordAction } from './macro/recording/recordAction';
export type { Macro } from './macro/recording/stopMacroRecording';

export { pushUndoEntry } from './pushUndoEntry';

export { undo, redo, undoToIndex } from './undoRedo';
