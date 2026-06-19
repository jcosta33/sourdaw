// Canonical `AppAction` union and its companion types live in
// `../useCases/commandQueries`. This module previously held a *second* copy of
// the union that had drifted from it (notably whether fields like
// `setEditingTool.tool` / `addChordEvent.quality` / `setWarpAlgorithm.algorithm`
// / `stemSeparate.stems` were typed as a literal union or bare `string`), so a
// payload's checking depended on which copy a call site happened to reference.
// The single source of truth now lives in `commandQueries`; this file re-exports
// it so its remaining out-of-module importer (Command/stores/commitActionUndoEntry.ts)
// resolves the same definition. Those AI-reachable fields stay `string` in the
// canonical union because AI-produced actions arrive as `AiRuntime`'s
// structurally-assigned `RuntimeAction` (whose values are not narrowed before
// dispatch — the handler validates them, e.g. handleStemSeparate's `isValidStem`).
// New code should import from `commandQueries` (or the `useCases` barrel) directly.
export type {
    AppAction,
    AppActionType,
    TrackKind,
    AutomationMode,
    TrackSnapshot,
    ClipSnapshot,
    AutomationLaneSnapshot,
    AutomationPointSnapshot,
    TakeLaneSnapshot,
    MidiNotesSnapshot,
    MidiCcSnapshot,
    MidiPitchBendSnapshot,
    RippleShiftSnapshot,
    RipplePlanSnapshot,
    HandlerDescribeResult,
    ActionHandler,
    UndoSource,
    ActionUndoEntry,
    CallbackUndoEntry,
    UndoEntry,
} from '../useCases/commandQueries';
