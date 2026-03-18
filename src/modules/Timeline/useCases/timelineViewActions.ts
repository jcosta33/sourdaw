/**
 * Timeline View Actions — use case wrappers for cross-module calls
 * used by Timeline presentation views and hooks.
 *
 * The presentations layer cannot import use cases from other modules
 * directly. This module-local use case delegates to each cross-module
 * use case so presentation files only import from within Timeline.
 */

// ── Track: clip editing ───────────────────────────────────────────
import {
    splitClip as _splitClip,
    normalizeClip as _normalizeClip,
    reverseClip as _reverseClip,
    lockClip as _lockClip,
    setClipColor as _setClipColor,
    renameClip as _renameClip,
    muteClip as _muteClip,
    trimClipStart as _trimClipStart,
    trimClipEnd as _trimClipEnd,
} from '#/modules/Track/useCases/clipEditingUseCases';

export const splitClip: typeof _splitClip = (...args) => _splitClip(...args);
export const normalizeClip: typeof _normalizeClip = (...args) => _normalizeClip(...args);
export const reverseClip: typeof _reverseClip = (...args) => _reverseClip(...args);
export const lockClip: typeof _lockClip = (...args) => _lockClip(...args);
export const setClipColor: typeof _setClipColor = (...args) => _setClipColor(...args);
export const renameClip: typeof _renameClip = (...args) => _renameClip(...args);
export const muteClip: typeof _muteClip = (...args) => _muteClip(...args);
export const trimClipStart: typeof _trimClipStart = (...args) => _trimClipStart(...args);
export const trimClipEnd: typeof _trimClipEnd = (...args) => _trimClipEnd(...args);

// ── Track: clip operations ────────────────────────────────────────
import {
    addClip as _addClip,
    removeClip as _removeClip,
    duplicateClip as _duplicateClip,
    duplicateClipToNextBar as _duplicateClipToNextBar,
    moveClipPreview as _moveClipPreview,
    moveClip as _moveClip,
} from '#/modules/Track/useCases/clipUseCases';

export const addClip: typeof _addClip = (...args) => _addClip(...args);
export const removeClip: typeof _removeClip = (...args) => _removeClip(...args);
export const duplicateClip: typeof _duplicateClip = (...args) => _duplicateClip(...args);
export const duplicateClipToNextBar: typeof _duplicateClipToNextBar = (...args) => _duplicateClipToNextBar(...args);
export const moveClipPreview: typeof _moveClipPreview = (...args) => _moveClipPreview(...args);
export const moveClip: typeof _moveClip = (...args) => _moveClip(...args);

// ── Track: clipboard ──────────────────────────────────────────────
import {
    copySelectedClip as _copySelectedClip,
    cutSelectedClip as _cutSelectedClip,
    pasteClip as _pasteClip,
} from '#/modules/Track/useCases/clipboardUseCases';

export const copySelectedClip: typeof _copySelectedClip = (...args) => _copySelectedClip(...args);
export const cutSelectedClip: typeof _cutSelectedClip = (...args) => _cutSelectedClip(...args);
export const pasteClip: typeof _pasteClip = (...args) => _pasteClip(...args);

// ── Track: general ────────────────────────────────────────────────
import { selectTrack as _selectTrack } from '#/modules/Track/useCases/toggleTrackState';
import { addTrack as _addTrack } from '#/modules/Track/useCases/addTrack';
import { addDevice as _addDevice } from '#/modules/Track/useCases/deviceUseCases';
import { exportMidiClip as _exportMidiClip } from '#/modules/Track/useCases/exportMidiFile';
import { importMidiFile as _importMidiFile } from '#/modules/Track/useCases/importMidiFile';
import { stripSilence as _stripSilence } from '#/modules/Track/useCases/stripSilence';

export const selectTrack: typeof _selectTrack = (...args) => _selectTrack(...args);
export const addTrack: typeof _addTrack = (...args) => _addTrack(...args);
export const addDevice: typeof _addDevice = (...args) => _addDevice(...args);
export const exportMidiClip: typeof _exportMidiClip = (...args) => _exportMidiClip(...args);
export const importMidiFile: typeof _importMidiFile = (...args) => _importMidiFile(...args);
export const stripSilence: typeof _stripSilence = (...args) => _stripSilence(...args);

// ── Track: automation ─────────────────────────────────────────────
import {
    addAutomationPoint as _addAutomationPoint,
    addAutomationLane as _addAutomationLane,
    removeAutomationPoint as _removeAutomationPoint,
    batchAddAutomationPoints as _batchAddAutomationPoints,
} from '#/modules/Track/useCases/automationUseCases';

export const addAutomationPoint: typeof _addAutomationPoint = (...args) => _addAutomationPoint(...args);
export const addAutomationLane: typeof _addAutomationLane = (...args) => _addAutomationLane(...args);
export const removeAutomationPoint: typeof _removeAutomationPoint = (...args) => _removeAutomationPoint(...args);
export const batchAddAutomationPoints: typeof _batchAddAutomationPoints = (...args) =>
    _batchAddAutomationPoints(...args);

// ── AiRuntime ─────────────────────────────────────────────────────
import { detectTempo as _detectTempo } from '#/modules/AiRuntime/useCases/tempoDetection';
import { detectKey as _detectKey } from '#/modules/AiRuntime/useCases/keyDetection';

export const detectTempo: typeof _detectTempo = (...args) => _detectTempo(...args);
export const detectKey: typeof _detectKey = (...args) => _detectKey(...args);

// ── AudioEngine ───────────────────────────────────────────────────
import { decodeAudioFile as _decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';

export const decodeAudioFile: typeof _decodeAudioFile = (...args) => _decodeAudioFile(...args);

// ── Command ───────────────────────────────────────────────────────
import { pushUndoEntry as _pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { executeAppAction as _executeAppAction } from '#/modules/Command/useCases/executeAppAction';

export const pushUndoEntry: typeof _pushUndoEntry = (...args) => _pushUndoEntry(...args);
export const executeAppAction: typeof _executeAppAction = (...args) => _executeAppAction(...args);

// ── Workspace ─────────────────────────────────────────────────────
import { setWorkspaceMode as _setWorkspaceMode } from '#/modules/Workspace/useCases/setWorkspaceMode';

export const setWorkspaceMode: typeof _setWorkspaceMode = (...args) => _setWorkspaceMode(...args);

// ── Transport ─────────────────────────────────────────────────────
import { setLoopRegion as _setLoopRegion } from '#/modules/Transport/useCases/transportControls';

export const setLoopRegion: typeof _setLoopRegion = (...args) => _setLoopRegion(...args);
