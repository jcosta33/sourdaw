/**
 * Timeline View Actions — re-exports of use cases consumed by Timeline
 * presentation views and hooks.
 *
 * The presentations layer imports from this module-local path rather than
 * reaching into other modules' internals directly.
 */

// ── Track: clip editing ───────────────────────────────────────────
export { splitClip } from '#/modules/Arrangement/useCases/clipEditing/splitClip';
export { splitClipWithUndo } from '#/modules/Arrangement/useCases/clipEditing/splitClipWithUndo';
export { normalizeClip } from '#/modules/Arrangement/useCases/clipEditing/normalizeClip';
export { reverseClip } from '#/modules/Arrangement/useCases/clipEditing/reverseClip';
export { lockClip } from '#/modules/Arrangement/useCases/clipEditing/lockClip';
export { setClipColor } from '#/modules/Arrangement/useCases/clipEditing/setClipColor';
export { renameClip } from '#/modules/Arrangement/useCases/clipEditing/renameClip';
export { muteClip } from '#/modules/Arrangement/useCases/clipEditing/muteClip';
export { trimClipStart } from '#/modules/Arrangement/useCases/clipEditing/trimClipStart';
export { trimClipEnd } from '#/modules/Arrangement/useCases/clipEditing/trimClipEnd';

// ── Track: clip operations ────────────────────────────────────────
export { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
export { removeClip } from '#/modules/Arrangement/useCases/clip/removeClip';
export { duplicateClip } from '#/modules/Arrangement/useCases/clip/duplicateClip';
export { duplicateClipToNextBar } from '#/modules/Arrangement/useCases/clip/duplicateClipToNextBar';
export { moveClipPreview } from '#/modules/Arrangement/useCases/clip/moveClipPreview';
export { moveClip } from '#/modules/Arrangement/useCases/clip/moveClip';

// ── Track: clipboard ──────────────────────────────────────────────
export { copySelectedClip } from '#/modules/Arrangement/useCases/clipboard/copySelectedClip';
export { cutSelectedClip } from '#/modules/Arrangement/useCases/clipboard/cutSelectedClip';
export { pasteClip } from '#/modules/Arrangement/useCases/clipboard/pasteClip';

// ── Track: general ────────────────────────────────────────────────
export { selectTrack } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
export { addTrack } from '#/modules/Arrangement/useCases/addTrack';
export { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
export { exportMidiClip } from '#/modules/Arrangement/useCases/exportMidiClip';
export { importMidiFile } from '#/modules/Arrangement/useCases/importMidiFile';
export { stripSilence } from '#/modules/Arrangement/useCases/stripSilence';

// ── Track: automation ─────────────────────────────────────────────
export {
    addAutomationLane,
    addAutomationPoint,
    batchAddAutomationPoints,
    removeAutomationPoint,
} from '#/modules/Automation/useCases';
export { detectKey, detectTempo } from '#/modules/AudioAnalysis/useCases';
export { decodeAudioFile } from '#/modules/AudioEngine/useCases';
export { executeAppAction, pushUndoEntry } from '#/modules/Command/useCases';
export { setLoopRegion } from '#/modules/Transport/useCases';
export { setWorkspaceMode } from '#/modules/Workspace/useCases';
