import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { trackStore } from '../stores/trackStore';
import { warpStateStore } from '../stores/warpStates';
import { getArrangementHandlers } from '../useCases/getArrangementHandlers';

import { ClipDummy } from './ClipDummy';
import { TrackDummy } from './TrackDummy';

export const WARP_AUDIO_CLIP_ID = 'clip-1';
export const WARP_MIDI_CLIP_ID = 'clip-midi';

/**
 * A real document and handler registry holding one audio clip and one MIDI
 * clip, so warp edits run through `executeAppAction` exactly as in the app.
 */
export function openWarpActionProject(): void {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('warp action project');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    clearUndoHistory();
    resetActionReplayAuthority();
    setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' as const }),
        clear: () => undefined,
    });
    macroStore.set({ macros: [], recording: false, currentRecording: [] });
    warpStateStore.set({ states: {} });
    const audioClip = ClipDummy.create({ id: WARP_AUDIO_CLIP_ID, startBeat: 0, endBeat: 8 });
    const midiClip = ClipDummy.create({ id: WARP_MIDI_CLIP_ID, startBeat: 0, endBeat: 8, type: 'midi' });
    const track = TrackDummy.create({ id: 'track-1', clips: [audioClip, midiClip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
}

export function closeWarpActionProject(): void {
    clearUndoHistory();
    resetActionReplayAuthority();
    clearHandlerRegistry();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    warpStateStore.set({ states: {} });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
}
