/**
 * Timeline View Actions — use case wrappers for cross-module calls
 * used by Timeline presentation views and hooks.
 *
 * The presentations layer cannot import use cases from other modules
 * directly. This module-local use case delegates to each cross-module
 * use case so presentation files only import from within Timeline.
 *
 * Each export uses `inject()` so tests can substitute collaborators via
 * `injectDependencies` without `vi.mock` on whole modules.
 */

import { inject } from '#/infra/di/inject';

// ── Track: clip editing ───────────────────────────────────────────
import { splitClip as splitClipImpl } from '#/modules/Arrangement/useCases/clipEditing/splitClip';
import { splitClipWithUndo as splitClipWithUndoImpl } from '#/modules/Arrangement/useCases/clipEditing/splitClipWithUndo';
import { normalizeClip as normalizeClipImpl } from '#/modules/Arrangement/useCases/clipEditing/normalizeClip';
import { reverseClip as reverseClipImpl } from '#/modules/Arrangement/useCases/clipEditing/reverseClip';
import { lockClip as lockClipImpl } from '#/modules/Arrangement/useCases/clipEditing/lockClip';
import { setClipColor as setClipColorImpl } from '#/modules/Arrangement/useCases/clipEditing/setClipColor';
import { renameClip as renameClipImpl } from '#/modules/Arrangement/useCases/clipEditing/renameClip';
import { muteClip as muteClipImpl } from '#/modules/Arrangement/useCases/clipEditing/muteClip';
import { trimClipStart as trimClipStartImpl } from '#/modules/Arrangement/useCases/clipEditing/trimClipStart';
import { trimClipEnd as trimClipEndImpl } from '#/modules/Arrangement/useCases/clipEditing/trimClipEnd';

// ── Track: clip operations ────────────────────────────────────────
import { addClip as addClipImpl } from '#/modules/Arrangement/useCases/clip/addClip';
import { removeClip as removeClipImpl } from '#/modules/Arrangement/useCases/clip/removeClip';
import { duplicateClip as duplicateClipImpl } from '#/modules/Arrangement/useCases/clip/duplicateClip';
import { duplicateClipToNextBar as duplicateClipToNextBarImpl } from '#/modules/Arrangement/useCases/clip/duplicateClipToNextBar';
import { moveClipPreview as moveClipPreviewImpl } from '#/modules/Arrangement/useCases/clip/moveClipPreview';
import { moveClip as moveClipImpl } from '#/modules/Arrangement/useCases/clip/moveClip';

// ── Track: clipboard ──────────────────────────────────────────────
import { copySelectedClip as copySelectedClipImpl } from '#/modules/Arrangement/useCases/clipboard/copySelectedClip';
import { cutSelectedClip as cutSelectedClipImpl } from '#/modules/Arrangement/useCases/clipboard/cutSelectedClip';
import { pasteClip as pasteClipImpl } from '#/modules/Arrangement/useCases/clipboard/pasteClip';

// ── Track: general ────────────────────────────────────────────────
import { selectTrack as selectTrackImpl } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
import { addTrack as addTrackImpl } from '#/modules/Arrangement/useCases/addTrack';
import { addDevice as addDeviceImpl } from '#/modules/Arrangement/useCases/device/addDevice';
import { exportMidiClip as exportMidiClipImpl } from '#/modules/MIDI/useCases/exportMidiFile';
import { importMidiFile as importMidiFileImpl } from '#/modules/MIDI/useCases/importMidiFile';
import { stripSilence as stripSilenceImpl } from '#/modules/Arrangement/useCases/stripSilence';

// ── Track: automation ─────────────────────────────────────────────
import { addAutomationPoint as addAutomationPointImpl } from '#/modules/Automation/useCases/automation/addAutomationPoint';
import { addAutomationLane as addAutomationLaneImpl } from '#/modules/Automation/useCases/automation/addAutomationLane';
import { removeAutomationPoint as removeAutomationPointImpl } from '#/modules/Automation/useCases/automation/removeAutomationPoint';
import { batchAddAutomationPoints as batchAddAutomationPointsImpl } from '#/modules/Automation/useCases/automation/batchAddAutomationPoints';

// ── AudioAnalysis ─────────────────────────────────────────────────
import { detectTempo as detectTempoImpl } from '#/modules/AudioAnalysis/useCases/tempoDetection';
import { detectKey as detectKeyImpl } from '#/modules/AudioAnalysis/useCases/keyDetection';

// ── AudioEngine ───────────────────────────────────────────────────
import { decodeAudioFile as decodeAudioFileImpl } from '#/modules/AudioEngine/useCases/decodeAudioFile';

// ── Command ───────────────────────────────────────────────────────
import { pushUndoEntry as pushUndoEntryImpl } from '#/modules/Command/useCases/pushUndoEntry';
import { executeAppAction as executeAppActionImpl } from '#/modules/Command/useCases/executeAppAction';

// ── Workspace ─────────────────────────────────────────────────────
import { setWorkspaceMode as setWorkspaceModeImpl } from '#/modules/Workspace/useCases/setWorkspaceMode';

// ── Transport ─────────────────────────────────────────────────────
import { setLoopRegion as setLoopRegionImpl } from '#/modules/Transport/useCases/transportControls/setLoopRegion';

export const splitClip = inject({ splitClipImpl })(
    ({ splitClipImpl }) =>
        function splitClip(...args: Parameters<typeof splitClipImpl>) {
            return splitClipImpl(...args);
        }
);

export const splitClipWithUndo = inject({ splitClipWithUndoImpl })(
    ({ splitClipWithUndoImpl }) =>
        function splitClipWithUndo(...args: Parameters<typeof splitClipWithUndoImpl>) {
            return splitClipWithUndoImpl(...args);
        }
);

export const normalizeClip = inject({ normalizeClipImpl })(
    ({ normalizeClipImpl }) =>
        function normalizeClip(...args: Parameters<typeof normalizeClipImpl>) {
            return normalizeClipImpl(...args);
        }
);

export const reverseClip = inject({ reverseClipImpl })(
    ({ reverseClipImpl }) =>
        function reverseClip(...args: Parameters<typeof reverseClipImpl>) {
            return reverseClipImpl(...args);
        }
);

export const lockClip = inject({ lockClipImpl })(
    ({ lockClipImpl }) =>
        function lockClip(...args: Parameters<typeof lockClipImpl>) {
            return lockClipImpl(...args);
        }
);

export const setClipColor = inject({ setClipColorImpl })(
    ({ setClipColorImpl }) =>
        function setClipColor(...args: Parameters<typeof setClipColorImpl>) {
            return setClipColorImpl(...args);
        }
);

export const renameClip = inject({ renameClipImpl })(
    ({ renameClipImpl }) =>
        function renameClip(...args: Parameters<typeof renameClipImpl>) {
            return renameClipImpl(...args);
        }
);

export const muteClip = inject({ muteClipImpl })(
    ({ muteClipImpl }) =>
        function muteClip(...args: Parameters<typeof muteClipImpl>) {
            return muteClipImpl(...args);
        }
);

export const trimClipStart = inject({ trimClipStartImpl })(
    ({ trimClipStartImpl }) =>
        function trimClipStart(...args: Parameters<typeof trimClipStartImpl>) {
            return trimClipStartImpl(...args);
        }
);

export const trimClipEnd = inject({ trimClipEndImpl })(
    ({ trimClipEndImpl }) =>
        function trimClipEnd(...args: Parameters<typeof trimClipEndImpl>) {
            return trimClipEndImpl(...args);
        }
);

export const addClip = inject({ addClipImpl })(
    ({ addClipImpl }) =>
        function addClip(...args: Parameters<typeof addClipImpl>) {
            return addClipImpl(...args);
        }
);

export const removeClip = inject({ removeClipImpl })(
    ({ removeClipImpl }) =>
        function removeClip(...args: Parameters<typeof removeClipImpl>) {
            return removeClipImpl(...args);
        }
);

export const duplicateClip = inject({ duplicateClipImpl })(
    ({ duplicateClipImpl }) =>
        function duplicateClip(...args: Parameters<typeof duplicateClipImpl>) {
            return duplicateClipImpl(...args);
        }
);

export const duplicateClipToNextBar = inject({ duplicateClipToNextBarImpl })(
    ({ duplicateClipToNextBarImpl }) =>
        function duplicateClipToNextBar(...args: Parameters<typeof duplicateClipToNextBarImpl>) {
            return duplicateClipToNextBarImpl(...args);
        }
);

export const moveClipPreview = inject({ moveClipPreviewImpl })(
    ({ moveClipPreviewImpl }) =>
        function moveClipPreview(...args: Parameters<typeof moveClipPreviewImpl>) {
            return moveClipPreviewImpl(...args);
        }
);

export const moveClip = inject({ moveClipImpl })(
    ({ moveClipImpl }) =>
        function moveClip(...args: Parameters<typeof moveClipImpl>) {
            return moveClipImpl(...args);
        }
);

export const copySelectedClip = inject({ copySelectedClipImpl })(
    ({ copySelectedClipImpl }) =>
        function copySelectedClip(...args: Parameters<typeof copySelectedClipImpl>) {
            return copySelectedClipImpl(...args);
        }
);

export const cutSelectedClip = inject({ cutSelectedClipImpl })(
    ({ cutSelectedClipImpl }) =>
        function cutSelectedClip(...args: Parameters<typeof cutSelectedClipImpl>) {
            return cutSelectedClipImpl(...args);
        }
);

export const pasteClip = inject({ pasteClipImpl })(
    ({ pasteClipImpl }) =>
        function pasteClip(...args: Parameters<typeof pasteClipImpl>) {
            return pasteClipImpl(...args);
        }
);

export const selectTrack = inject({ selectTrackImpl })(
    ({ selectTrackImpl }) =>
        function selectTrack(...args: Parameters<typeof selectTrackImpl>) {
            return selectTrackImpl(...args);
        }
);

export const addTrack = inject({ addTrackImpl })(
    ({ addTrackImpl }) =>
        function addTrack(...args: Parameters<typeof addTrackImpl>) {
            return addTrackImpl(...args);
        }
);

export const addDevice = inject({ addDeviceImpl })(
    ({ addDeviceImpl }) =>
        function addDevice(...args: Parameters<typeof addDeviceImpl>) {
            return addDeviceImpl(...args);
        }
);

export const exportMidiClip = inject({ exportMidiClipImpl })(
    ({ exportMidiClipImpl }) =>
        function exportMidiClip(...args: Parameters<typeof exportMidiClipImpl>) {
            return exportMidiClipImpl(...args);
        }
);

export const importMidiFile = inject({ importMidiFileImpl })(
    ({ importMidiFileImpl }) =>
        function importMidiFile(...args: Parameters<typeof importMidiFileImpl>) {
            return importMidiFileImpl(...args);
        }
);

export const stripSilence = inject({ stripSilenceImpl })(
    ({ stripSilenceImpl }) =>
        function stripSilence(...args: Parameters<typeof stripSilenceImpl>) {
            return stripSilenceImpl(...args);
        }
);

export const addAutomationPoint = inject({ addAutomationPointImpl })(
    ({ addAutomationPointImpl }) =>
        function addAutomationPoint(...args: Parameters<typeof addAutomationPointImpl>) {
            return addAutomationPointImpl(...args);
        }
);

export const addAutomationLane = inject({ addAutomationLaneImpl })(
    ({ addAutomationLaneImpl }) =>
        function addAutomationLane(...args: Parameters<typeof addAutomationLaneImpl>) {
            return addAutomationLaneImpl(...args);
        }
);

export const removeAutomationPoint = inject({ removeAutomationPointImpl })(
    ({ removeAutomationPointImpl }) =>
        function removeAutomationPoint(...args: Parameters<typeof removeAutomationPointImpl>) {
            return removeAutomationPointImpl(...args);
        }
);

export const batchAddAutomationPoints = inject({ batchAddAutomationPointsImpl })(
    ({ batchAddAutomationPointsImpl }) =>
        function batchAddAutomationPoints(...args: Parameters<typeof batchAddAutomationPointsImpl>) {
            return batchAddAutomationPointsImpl(...args);
        }
);

export const detectTempo = inject({ detectTempoImpl })(
    ({ detectTempoImpl }) =>
        function detectTempo(...args: Parameters<typeof detectTempoImpl>) {
            return detectTempoImpl(...args);
        }
);

export const detectKey = inject({ detectKeyImpl })(
    ({ detectKeyImpl }) =>
        function detectKey(...args: Parameters<typeof detectKeyImpl>) {
            return detectKeyImpl(...args);
        }
);

export const decodeAudioFile = inject({ decodeAudioFileImpl })(
    ({ decodeAudioFileImpl }) =>
        function decodeAudioFile(...args: Parameters<typeof decodeAudioFileImpl>) {
            return decodeAudioFileImpl(...args);
        }
);

export const pushUndoEntry = inject({ pushUndoEntryImpl })(
    ({ pushUndoEntryImpl }) =>
        function pushUndoEntry(...args: Parameters<typeof pushUndoEntryImpl>) {
            return pushUndoEntryImpl(...args);
        }
);

export const executeAppAction = inject({ executeAppActionImpl })(
    ({ executeAppActionImpl }) =>
        function executeAppAction(...args: Parameters<typeof executeAppActionImpl>) {
            return executeAppActionImpl(...args);
        }
);

export const setWorkspaceMode = inject({ setWorkspaceModeImpl })(
    ({ setWorkspaceModeImpl }) =>
        function setWorkspaceMode(...args: Parameters<typeof setWorkspaceModeImpl>) {
            return setWorkspaceModeImpl(...args);
        }
);

export const setLoopRegion = inject({ setLoopRegionImpl })(
    ({ setLoopRegionImpl }) =>
        function setLoopRegion(...args: Parameters<typeof setLoopRegionImpl>) {
            return setLoopRegionImpl(...args);
        }
);
