/**
 * Timeline View Actions — use case wrappers for cross-module calls
 * used by Timeline presentation views and hooks.
 *
 * The presentations layer cannot import use cases from other modules
 * directly. This module-local use case delegates to each cross-module
 * use case so presentation files only import from within Timeline.
 */

// ── Track: clip editing ───────────────────────────────────────────
import { splitClip as _splitClip } from '#/modules/Arrangement/useCases/clipEditing/splitClip';
import { splitClipWithUndo as _splitClipWithUndo } from '#/modules/Arrangement/useCases/clipEditing/splitClipWithUndo';
import { normalizeClip as _normalizeClip } from '#/modules/Arrangement/useCases/clipEditing/normalizeClip';
import { reverseClip as _reverseClip } from '#/modules/Arrangement/useCases/clipEditing/reverseClip';
import { lockClip as _lockClip } from '#/modules/Arrangement/useCases/clipEditing/lockClip';
import { setClipColor as _setClipColor } from '#/modules/Arrangement/useCases/clipEditing/setClipColor';
import { renameClip as _renameClip } from '#/modules/Arrangement/useCases/clipEditing/renameClip';
import { muteClip as _muteClip } from '#/modules/Arrangement/useCases/clipEditing/muteClip';
import { trimClipStart as _trimClipStart } from '#/modules/Arrangement/useCases/clipEditing/trimClipStart';
import { trimClipEnd as _trimClipEnd } from '#/modules/Arrangement/useCases/clipEditing/trimClipEnd';

export const splitClip: typeof _splitClip = (...args) => _splitClip(...args);
export const splitClipWithUndo: typeof _splitClipWithUndo = (...args) => _splitClipWithUndo(...args);
export const normalizeClip: typeof _normalizeClip = (...args) => _normalizeClip(...args);
export const reverseClip: typeof _reverseClip = (...args) => _reverseClip(...args);
export const lockClip: typeof _lockClip = (...args) => _lockClip(...args);
export const setClipColor: typeof _setClipColor = (...args) => _setClipColor(...args);
export const renameClip: typeof _renameClip = (...args) => _renameClip(...args);
export const muteClip: typeof _muteClip = (...args) => _muteClip(...args);
export const trimClipStart: typeof _trimClipStart = (...args) => _trimClipStart(...args);
export const trimClipEnd: typeof _trimClipEnd = (...args) => _trimClipEnd(...args);

// ── Track: clip operations ────────────────────────────────────────
import { addClip as _addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { removeClip as _removeClip } from '#/modules/Arrangement/useCases/clip/removeClip';
import { duplicateClip as _duplicateClip } from '#/modules/Arrangement/useCases/clip/duplicateClip';
import { duplicateClipToNextBar as _duplicateClipToNextBar } from '#/modules/Arrangement/useCases/clip/duplicateClipToNextBar';
import { moveClipPreview as _moveClipPreview } from '#/modules/Arrangement/useCases/clip/moveClipPreview';
import { moveClip as _moveClip } from '#/modules/Arrangement/useCases/clip/moveClip';

export const addClip: typeof _addClip = (...args) => _addClip(...args);
export const removeClip: typeof _removeClip = (...args) => _removeClip(...args);
export const duplicateClip: typeof _duplicateClip = (...args) => _duplicateClip(...args);
export const duplicateClipToNextBar: typeof _duplicateClipToNextBar = (...args) => _duplicateClipToNextBar(...args);
export const moveClipPreview: typeof _moveClipPreview = (...args) => _moveClipPreview(...args);
export const moveClip: typeof _moveClip = (...args) => _moveClip(...args);

// ── Track: clipboard ──────────────────────────────────────────────
import { copySelectedClip as _copySelectedClip } from '#/modules/Arrangement/useCases/clipboard/copySelectedClip';
import { cutSelectedClip as _cutSelectedClip } from '#/modules/Arrangement/useCases/clipboard/cutSelectedClip';
import { pasteClip as _pasteClip } from '#/modules/Arrangement/useCases/clipboard/pasteClip';

export const copySelectedClip: typeof _copySelectedClip = (...args) => _copySelectedClip(...args);
export const cutSelectedClip: typeof _cutSelectedClip = (...args) => _cutSelectedClip(...args);
export const pasteClip: typeof _pasteClip = (...args) => _pasteClip(...args);

// ── Track: general ────────────────────────────────────────────────
import { selectTrack as _selectTrack } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
import { addTrack as _addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { addDevice as _addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { exportMidiClip as _exportMidiClip } from '#/modules/MIDI/useCases/exportMidiFile';
import { importMidiFile as _importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';
import { stripSilence as _stripSilence } from '#/modules/Arrangement/useCases/stripSilence';

export const selectTrack: typeof _selectTrack = (...args) => _selectTrack(...args);
export const addTrack = (...args: Parameters<typeof _addTrack>) => _addTrack(...args);
export const addDevice: typeof _addDevice = (...args) => _addDevice(...args);
export const exportMidiClip: typeof _exportMidiClip = (...args) => _exportMidiClip(...args);
export const importMidiFile: typeof _importMidiFile = (...args) => _importMidiFile(...args);
export const stripSilence: typeof _stripSilence = (...args) => _stripSilence(...args);

// ── Track: automation ─────────────────────────────────────────────
import { addAutomationPoint as _addAutomationPoint } from '#/modules/Automation/useCases/automation/addAutomationPoint';
import { addAutomationLane as _addAutomationLane } from '#/modules/Automation/useCases/automation/addAutomationLane';
import { removeAutomationPoint as _removeAutomationPoint } from '#/modules/Automation/useCases/automation/removeAutomationPoint';
import { batchAddAutomationPoints as _batchAddAutomationPoints } from '#/modules/Automation/useCases/automation/batchAddAutomationPoints';

export const addAutomationPoint: typeof _addAutomationPoint = (...args) => _addAutomationPoint(...args);
export const addAutomationLane: typeof _addAutomationLane = (...args) => _addAutomationLane(...args);
export const removeAutomationPoint: typeof _removeAutomationPoint = (...args) => _removeAutomationPoint(...args);
export const batchAddAutomationPoints: typeof _batchAddAutomationPoints = (...args) =>
    _batchAddAutomationPoints(...args);

// ── AiRuntime ─────────────────────────────────────────────────────
import { detectTempo as _detectTempo } from '#/modules/AudioAnalysis/useCases/tempoDetection';
import { detectKey as _detectKey } from '#/modules/AudioAnalysis/useCases/keyDetection';

export const detectTempo: typeof _detectTempo = (...args) => _detectTempo(...args);
export const detectKey: typeof _detectKey = (...args) => _detectKey(...args);

// ── AudioEngine ───────────────────────────────────────────────────
import { decodeAudioFile as _decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';

export const decodeAudioFile: typeof _decodeAudioFile = (...args) => _decodeAudioFile(...args);

// ── Command ───────────────────────────────────────────────────────
import { pushUndoEntry as _pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { executeAppAction as _executeAppAction } from '#/modules/Command/useCases/executeAppAction';

export const pushUndoEntry: typeof _pushUndoEntry = (...args) => _pushUndoEntry(...args);
export const executeAppAction = (...args: Parameters<typeof _executeAppAction>) => _executeAppAction(...args);

// ── Workspace ─────────────────────────────────────────────────────
import { setWorkspaceMode as _setWorkspaceMode } from '#/modules/Workspace/useCases/setWorkspaceMode';

export const setWorkspaceMode: typeof _setWorkspaceMode = (...args) => _setWorkspaceMode(...args);

// ── Transport ─────────────────────────────────────────────────────
import { setLoopRegion as _setLoopRegion } from '#/modules/Transport/useCases/transportControls/setLoopRegion';

export const setLoopRegion: typeof _setLoopRegion = (...args) => _setLoopRegion(...args);
