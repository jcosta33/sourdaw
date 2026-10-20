import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { addMidiCC, addPitchBend, appendRecordedMidiNote } from '#/modules/MIDI/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { startRecording } from '../../../useCases/recording/startRecording';
import { stopRecording } from '../../../useCases/recording/stopRecording';

const TRACK_ID = 'track-midi';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/**
 * Controller and pitch-bend rows the live MIDI route writes into the recording
 * clip during the pass are part of the take: the one commit at stop snapshots
 * them, one undo removes them with the clip, and one redo restores the same
 * rows. The rows are written through the MIDI use cases the live route calls,
 * so the commit and undo run against the rows exactly as recording leaves them.
 */
describe('recorded controller take commit', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recorded controller take integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits the recorded controllers with the take, removes them on undo, and restores the same rows on redo', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        const clipId = provisional.id;
        appendRecordedMidiNote({
            clipId,
            note: { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
        });
        const pedalDown = addMidiCC(clipId, 64, 127, 0.5, 0);
        const pedalUp = addMidiCC(clipId, 64, 0, 1.5, 0);
        const bend = addPitchBend(clipId, 8191, 1, 0);
        flushAutomergeStorageWrites();

        await stopRecording(8);
        flushAutomergeStorageWrites();

        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);
        expect(midiStore.value?.notesByClipId[clipId]).toHaveLength(1);
        expect(midiStore.value?.ccByClipId[clipId]).toEqual([pedalDown, pedalUp]);
        expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual([bend]);

        await undo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
        expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
        expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();

        await redo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.ccByClipId[clipId]).toEqual([pedalDown, pedalUp]);
        expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual([bend]);
    });
});
