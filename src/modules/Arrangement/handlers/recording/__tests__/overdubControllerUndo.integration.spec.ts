import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Web MIDI input the take's live route listens on. Stubbed before the MIDI
 * module loads, because its supported-platform check reads `navigator` once at
 * import.
 */
const liveMidi = vi.hoisted(() => {
    const input = Object.assign(new EventTarget(), { id: 'live-input', name: 'Live input', manufacturer: 'Test' });
    const access = { inputs: new Map([[input.id, input]]), outputs: new Map(), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.resolve(access),
    });
    return { input, inputs: access.inputs };
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
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    destroyWebMidi,
    getWebMidiInputHandlers,
    initWebMidi,
    projectChannelBend,
    resetMidiState,
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

type ClipRows = {
    cc: unknown[];
    pitchBend: unknown[];
};

function readRows(clipId: string): ClipRows {
    return {
        cc: structuredClone(midiStore.value?.ccByClipId[clipId] ?? []),
        pitchBend: structuredClone(midiStore.value?.pitchBendByClipId[clipId] ?? []),
    };
}

/**
 * An overdub is a take recording into a clip an earlier take already holds
 * rows in. Its controller and pitch-bend rows land when the transport stops
 * recording, and they are one undoable edit: Undo removes exactly the rows the
 * pass added, Redo restores the same rows with the same ids.
 */
describe('overdubbed controller rows and undo', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('overdub controller undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getWebMidiInputHandlers());
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
        transportStore.set({
            ...transportStore.value!,
            isRecording: false,
            overdubEnabled: false,
            isLooping: false,
            playheadPosition: 4,
        });
        resetMidiState();
        setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
    });

    afterEach(() => {
        transportStore.set({ ...transportStore.value!, isRecording: false, overdubEnabled: false });
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

    const sendLive = (beat: number, ...bytes: number[]): void => {
        transportStore.set({ ...transportStore.value!, playheadPosition: beat });
        liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
    };

    async function startLiveTake(): Promise<string> {
        await initWebMidi();
        setMidiInputTrack(TRACK_ID);
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        transportStore.set({ ...transportStore.value!, isRecording: true });
        return provisional.id;
    }

    /** A first take that leaves a mod wheel row and a bend row in a committed clip. */
    async function recordFirstTake(): Promise<string> {
        const clipId = await startLiveTake();
        sendLive(4.5, 0xb0, 1, 55);
        sendLive(5, 0xe0, 104, 71);
        await stopRecording(12);
        transportStore.set({ ...transportStore.value!, isRecording: false });
        flushAutomergeStorageWrites();
        return clipId;
    }

    function beginOverdub(atBeat: number): void {
        transportStore.set({ ...transportStore.value!, overdubEnabled: true });
        expect(startRecording(atBeat)).toEqual([]);
        transportStore.set({ ...transportStore.value!, isRecording: true });
    }

    async function endOverdub(atBeat: number, expectedHistoryLength: number): Promise<void> {
        await stopRecording(atBeat);
        transportStore.set({ ...transportStore.value!, isRecording: false });
        await vi.waitFor(() => {
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(expectedHistoryLength);
        });
        flushAutomergeStorageWrites();
    }

    /** One overdub pass of a mod wheel move, a bend and a pedal held to the stop. */
    function playOverdubPass(): void {
        beginOverdub(6);
        sendLive(6.5, 0xb0, 1, 90);
        sendLive(7, 0xe0, 0, 96);
        sendLive(7.5, 0xb0, 64, 127);
    }

    it('lands the overdub rows as one undo step that removes exactly them and restores the same ids on redo', async () => {
        const clipId = await recordFirstTake();
        const takeRows = readRows(clipId);
        expect(takeRows.cc).toHaveLength(1);
        expect(takeRows.pitchBend).toHaveLength(1);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

        playOverdubPass();
        await endOverdub(8, 2);

        const overdubbedRows = readRows(clipId);
        expect(overdubbedRows.cc.length).toBeGreaterThan(takeRows.cc.length);
        expect(overdubbedRows.pitchBend).toHaveLength(2);
        expect(overdubbedRows.cc.slice(0, takeRows.cc.length)).toEqual(takeRows.cc);

        await undo();
        flushAutomergeStorageWrites();
        expect(readRows(clipId)).toEqual(takeRows);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

        await redo();
        flushAutomergeStorageWrites();
        expect(readRows(clipId)).toEqual(overdubbedRows);
    });

    it('keeps the overdub rows when the earlier take commit is undone and redone around them', async () => {
        const clipId = await recordFirstTake();
        playOverdubPass();
        await endOverdub(8, 2);
        const overdubbedRows = readRows(clipId);

        await undo();
        await undo();
        flushAutomergeStorageWrites();
        expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
        expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();

        await redo();
        await redo();
        flushAutomergeStorageWrites();
        expect(readRows(clipId)).toEqual(overdubbedRows);
    });

    it('removes the registered-parameter declarations the overdub added along with its own rows', async () => {
        const clipId = await recordFirstTake();
        const takeRows = readRows(clipId);

        // The keyboard moves its bend range to 12 semitones before the pass begins, so the
        // pass's bend replays under a range the earlier take never declared.
        sendLive(5, 0xb0, 101, 0);
        sendLive(5, 0xb0, 100, 0);
        sendLive(5, 0xb0, 6, 12);
        beginOverdub(6);
        sendLive(7, 0xe0, 0, 96);
        await endOverdub(8, 2);

        const overdubbedRows = readRows(clipId);
        const addedCc = overdubbedRows.cc.slice(takeRows.cc.length) as { controller: number }[];
        expect(addedCc.some((row) => row.controller === 101)).toBe(true);

        await undo();
        flushAutomergeStorageWrites();
        expect(readRows(clipId)).toEqual(takeRows);

        await redo();
        flushAutomergeStorageWrites();
        expect(readRows(clipId)).toEqual(overdubbedRows);
    });

    it('leaves a peer edit made after the overdub in place when the overdub is undone', async () => {
        const clipId = await recordFirstTake();
        playOverdubPass();
        await endOverdub(8, 2);
        const [firstRow] = readRows(clipId).cc as { id: string }[];
        const peerRow = { id: 'peer-cc', controller: 7, value: 90, beat: 1, channel: 0 };
        midiStore.set({
            ...midiStore.value!,
            ccByClipId: {
                ...midiStore.value!.ccByClipId,
                [clipId]: [...midiStore.value!.ccByClipId[clipId]!, peerRow],
            },
        });
        flushAutomergeStorageWrites();

        await undo();
        flushAutomergeStorageWrites();

        const remaining = readRows(clipId).cc as { id: string }[];
        expect(remaining.map((row) => row.id)).toEqual([firstRow!.id, 'peer-cc']);
    });

    /** Hold the project's snapshot transaction, as a collaboration persist does, until `release` is called. */
    async function holdSnapshotTransaction(): Promise<{ release: () => void; settled: Promise<unknown> }> {
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const settled = transactSnapshot(async () => {
            markStarted();
            await released;
        });
        await started;
        return { release, settled };
    }

    describe('a pass that ends while an earlier pass into the same clip is still landing', () => {
        it('reads the earlier pass bend at the range it was recorded under, as when the earlier pass lands first', async () => {
            const clipId = await recordFirstTake();
            const held = await holdSnapshotTransaction();

            // Pass 1 bends at the default range of two semitones; its rows wait behind the snapshot.
            beginOverdub(6);
            sendLive(7, 0xe0, 0, 96);
            transportStore.set({ ...transportStore.value!, isRecording: false });

            // The keyboard raises its bend range to twelve, then pass 2 bends earlier in the clip.
            sendLive(7.5, 0xb0, 101, 0);
            sendLive(7.5, 0xb0, 100, 0);
            sendLive(7.5, 0xb0, 6, 12);
            beginOverdub(5.5);
            sendLive(6, 0xe0, 0, 96);
            transportStore.set({ ...transportStore.value!, isRecording: false });

            held.release();
            await held.settled;
            await vi.waitFor(() => {
                expect(midiStore.value?.pitchBendByClipId[clipId]).toHaveLength(3);
            });
            flushAutomergeStorageWrites();

            const clip = trackStore.value!.tracks.flatMap((track) => track.clips).find(({ id }) => id === clipId)!;
            const ranges = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: midiStore.value!.ccByClipId[clipId] ?? [],
                        pitchBends: midiStore.value!.pitchBendByClipId[clipId] ?? [],
                    },
                ],
                frameAtBeat: (beat) => Math.round(beat * 1000),
            }).map(({ beat, rangeSemitones }) => [beat, rangeSemitones]);

            // Each bend plays under the range live when it was recorded: the first take's and pass 1's
            // under two semitones, pass 2's under twelve.
            expect(ranges).toEqual([
                [5, 2],
                [6, 12],
                [7, 2],
            ]);
        });
    });

    describe('a take into a clip whose commit has not run', () => {
        it('commits with its clip and adds no undo step of its own', async () => {
            const clipId = await startLiveTake();
            sendLive(4.5, 0xb0, 1, 55);
            const held = await holdSnapshotTransaction();
            transportStore.set({ ...transportStore.value!, isRecording: false });
            const stoppingFirst = stopRecording(8);

            // The next take begins inside the clip while the first commit still waits.
            beginOverdub(6);
            sendLive(6.5, 0xb0, 64, 127);
            sendLive(7, 0xb0, 64, 0);
            transportStore.set({ ...transportStore.value!, isRecording: false });
            held.release();
            await held.settled;
            await stoppingFirst;
            flushAutomergeStorageWrites();

            const rows = (midiStore.value?.ccByClipId[clipId] ?? []).map(({ controller, value }) => ({
                controller,
                value,
            }));
            expect(rows).toEqual([
                { controller: 1, value: 55 },
                { controller: 64, value: 127 },
                { controller: 64, value: 0 },
            ]);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

            await undo();
            flushAutomergeStorageWrites();
            expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();

            await redo();
            flushAutomergeStorageWrites();
            expect(midiStore.value?.ccByClipId[clipId]).toHaveLength(3);
        });
    });
});
