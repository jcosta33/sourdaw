import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Web MIDI input the take's live route listens on. Stubbed before the MIDI
 * module loads, because its supported-platform check reads `navigator` once at
 * import.
 */
const liveMidi = vi.hoisted(() => {
    const input = Object.assign(new EventTarget(), { id: 'live-input', name: 'Live input', manufacturer: 'Test' });
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.resolve(access),
    });
    return { input };
});

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
import {
    addMidiCC,
    addPitchBend,
    appendRecordedMidiNote,
    destroyWebMidi,
    initWebMidi,
    setMidiInputTrack,
    setWebMidiRuntimeEventBus,
} from '#/modules/MIDI/useCases';
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
 * rows. The rows reach the clip either through the MIDI editing writers or,
 * as in a real take, through the Web MIDI input route that dispatches to the
 * production recording writers.
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
        destroyWebMidi();
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

    // The Web MIDI input route is the barrel's way to the production
    // `handleWebMidiCC` / `handleWebMidiPitchBend`: those handlers are not
    // exported, and the input subscription is what calls them in the app.
    it('records pedal and bend messages arriving on the live input into one undoable take', async () => {
        setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
        await initWebMidi();
        setMidiInputTrack(TRACK_ID);
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        const clipId = provisional.id;
        transportStore.set({ ...transportStore.value!, isRecording: true });

        const send = (beat: number, ...bytes: number[]): void => {
            transportStore.set({ ...transportStore.value!, playheadPosition: beat });
            liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
        };
        send(4.5, 0xb0, 64, 127);
        send(5, 0xe0, 104, 71);
        send(5.5, 0xb0, 64, 0);
        send(5.5, 0xb0, 64, 127);
        flushAutomergeStorageWrites();

        await stopRecording(8);
        flushAutomergeStorageWrites();

        const rowsOf = <TRow extends { id: string }>(rows: readonly TRow[] | undefined) =>
            (rows ?? []).map(({ id: _id, ...row }) => row);
        const recordedCc = midiStore.value?.ccByClipId[clipId];
        const recordedBend = midiStore.value?.pitchBendByClipId[clipId];
        expect(rowsOf(recordedCc)).toEqual([
            { controller: 64, value: 127, beat: 0.5, channel: 0 },
            { controller: 64, value: 0, beat: 1.5, channel: 0 },
            { controller: 64, value: 127, beat: 1.5, channel: 0 },
        ]);
        expect(rowsOf(recordedBend)).toEqual([{ value: 1000, beat: 1, channel: 0 }]);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

        await undo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
        expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();

        await redo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.ccByClipId[clipId]).toEqual(recordedCc);
        expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual(recordedBend);
    });
});
