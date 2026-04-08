// presentations/views
export { CommandPalette } from './presentations/views/CommandPalette';
export { UndoHistoryPanel } from './presentations/views/UndoHistoryPanel';
export { useGlobalKeyboardShortcuts } from './presentations/views/keyboardShortcutsContract';

// stores
export { macroStore } from './stores/macroStore';
export type { MacroStoreState } from './stores/macroStore';
export { undoStore, pushUndo } from './stores/undoStore';
export type { UndoStoreState } from './stores/undoStore';

// useCases/actionLabels
export { ACTION_LABELS, describeAction } from './useCases/actionLabels';

// useCases/commandQueries
export type {
    UndoEntry,
    UndoSource,
    ActionUndoEntry,
    CallbackUndoEntry,
    AppAction,
    AppActionType,
    ActionHandler,
} from './useCases/commandQueries';
export {
    generateGroupId,
    createUndoEntry,
    createCallbackUndoEntry,
    isActionEntry,
} from './useCases/commandQueries';

// useCases/executeAppAction
export { executeAppAction } from './useCases/executeAppAction';
export type { ExecuteOptions } from './useCases/executeAppAction';

// useCases/keyboardShortcutActions/trackShortcuts
export {
    clearSolos,
    addTrack,
    duplicateTrack,
    duplicateClip,
    duplicateClipToNextBar,
    zoomTracksVertical,
} from './useCases/keyboardShortcutActions/trackShortcuts';

// useCases/keyboardShortcutActions/transportShortcuts
export {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleMetronome,
    toggleRecording,
    seekPlayhead,
} from './useCases/keyboardShortcutActions/transportShortcuts';

// useCases/macro/management
export { deleteMacro, renameMacro } from './useCases/macro/management';

// useCases/macro/playback
export { playMacro } from './useCases/macro/playback';

// useCases/macro/recording
export { startMacroRecording, stopMacroRecording, recordAction } from './useCases/macro/recording';
export type { Macro } from './useCases/macro/recording';

// useCases/pushUndoEntry
export { pushUndoEntry } from './useCases/pushUndoEntry';

// useCases/trackAlternativeHandlers
export {
    handleCreateTrackAlternative,
    handleSwitchTrackAlternative,
    handleRenameTrackAlternative,
    handleDeleteTrackAlternative,
} from './useCases/trackAlternativeHandlers';

// useCases/undoRedo
export { undo, redo, undoToIndex } from './useCases/undoRedo';
