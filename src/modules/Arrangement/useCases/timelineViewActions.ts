/**
 * Timeline View Actions — re-exports of use cases consumed by Timeline
 * presentation views and hooks.
 *
 * The presentations layer imports from this module-local path rather than
 * reaching into other modules' internals directly.
 */

// ── Track: clip editing ───────────────────────────────────────────
export { splitClip } from './clipEditing/splitClip';
export { splitClipWithUndo } from './clipEditing/splitClipWithUndo';
export { normalizeClip } from './clipEditing/normalizeClip';
export { reverseClip } from './clipEditing/reverseClip';
export { lockClip } from './clipEditing/lockClip';
export { setClipColor } from './clipEditing/setClipColor';
export { renameClip } from './clipEditing/renameClip';
export { muteClip } from './clipEditing/muteClip';
export { trimClipStart } from './clipEditing/trimClipStart';
export { trimClipEnd } from './clipEditing/trimClipEnd';

// ── Track: clip operations ────────────────────────────────────────
export { addClip } from './clip/addClip';
export { removeClip } from './clip/removeClip';
export { duplicateClip } from './clip/duplicateClip';
export { duplicateClipToNextBar } from './clip/duplicateClipToNextBar';
export { moveClip } from './clip/moveClip';

// ── Track: clipboard ──────────────────────────────────────────────
export { copySelectedClip } from './clipboard/copySelectedClip';
export { cutSelectedClip } from './clipboard/cutSelectedClip';
export { pasteClip } from './clipboard/pasteClip';

// ── Track: general ────────────────────────────────────────────────
export { selectTrack } from './toggleTrackState/selectTrack';
export { addTrack } from './addTrack';
export { addDevice } from './device/addDevice';
export { exportMidiClip } from './exportMidiClip';
export { importMidiFile } from './importMidiFile';
export { stripSilence } from './stripSilence';

// ── Track: automation ─────────────────────────────────────────────
export {
    addAutomationLane,
    addAutomationPoint,
    batchAddAutomationPoints,
    removeAutomationPoint,
} from '#/modules/Automation/useCases';
export { detectKey, detectTempo } from '#/modules/AudioAnalysis/useCases';
export { decodeAudioFile } from '#/modules/AudioEngine/useCases';
export { pushUndoEntry } from '#/modules/Command/stores';
export { executeAppAction } from '#/modules/Command/useCases';
export { setLoopRegion } from '#/modules/Transport/useCases';
export { setWorkspaceMode } from '#/modules/Workspace/useCases';
