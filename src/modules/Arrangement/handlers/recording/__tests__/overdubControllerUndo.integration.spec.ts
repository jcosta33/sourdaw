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

import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    productionBriefAdmissionPort,
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
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { countSettledTakes, isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';

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

    describe('under a production brief lock', () => {
        /** Lock a timeline range, with the admission the app installs at bootstrap. */
        function lockRange(startBeat: number, endBeat: number): void {
            productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
            projectStore.set({
                ...structuredClone(defaultProjectStoreState),
                productionBrief: {
                    ...structuredClone(defaultProjectStoreState.productionBrief),
                    locks: [
                        {
                            id: 'lock-range',
                            scope: { kind: 'range', startBeat, endBeat },
                            statement: 'Keep this range',
                            createdAt: 1,
                        },
                    ],
                },
            });
        }

        afterEach(() => {
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
            projectStore.set(structuredClone(defaultProjectStoreState));
        });

        it('lands an overdub into a clip outside every locked range, whatever beat its rows sit at', async () => {
            const clipId = await recordFirstTake();
            lockRange(0, 4);

            playOverdubPass();
            await endOverdub(8, 2);

            expect(readRows(clipId).cc.length).toBeGreaterThan(1);
            expect(readRows(clipId).pitchBend).toHaveLength(2);
        });

        it('refuses an overdub into a clip the lock covers and leaves its rows as the take left them', async () => {
            const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
            const clipId = await recordFirstTake();
            const takeRows = readRows(clipId);
            lockRange(4, 12);

            playOverdubPass();
            transportStore.set({ ...transportStore.value!, isRecording: false });
            await vi.waitFor(() => {
                expect(warn).toHaveBeenCalledWith(
                    '[MIDI] Recording the overdub controllers failed:',
                    expect.anything()
                );
            });

            expect(readRows(clipId)).toEqual(takeRows);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);
            warn.mockRestore();
        });
    });

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

    describe('a clip whose controller lists exist but are empty', () => {
        const hasList = (clipId: string): { cc: boolean; pitchBend: boolean } => ({
            cc: Object.hasOwn(midiStore.value?.ccByClipId ?? {}, clipId),
            pitchBend: Object.hasOwn(midiStore.value?.pitchBendByClipId ?? {}, clipId),
        });

        it('keeps the empty lists when the pass is undone, so the split before it can still be undone', async () => {
            const clipId = await startLiveTake();
            sendLive(10, 0xb0, 1, 55);
            sendLive(10, 0xe0, 104, 71);
            await stopRecording(12);
            transportStore.set({ ...transportStore.value!, isRecording: false });
            flushAutomergeStorageWrites();
            const takeRows = readRows(clipId);

            // The rows sit right of the cut, so the left half keeps its lists, emptied.
            await executeAppAction({ type: 'splitClip', payload: { clipId, beat: 8 } });
            flushAutomergeStorageWrites();
            expect(readRows(clipId)).toEqual({ cc: [], pitchBend: [] });
            expect(hasList(clipId)).toEqual({ cc: true, pitchBend: true });
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(2);

            beginOverdub(5);
            sendLive(6, 0xb0, 1, 90);
            await endOverdub(7, 3);
            expect(readRows(clipId).cc).toHaveLength(1);

            await undo();
            flushAutomergeStorageWrites();
            expect(readRows(clipId)).toEqual({ cc: [], pitchBend: [] });
            expect(hasList(clipId)).toEqual({ cc: true, pitchBend: true });

            await undo();
            flushAutomergeStorageWrites();
            const clips = trackStore.value!.tracks.flatMap((track) => track.clips);
            expect(clips.map((clip) => clip.id)).toEqual([clipId]);
            expect(readRows(clipId)).toEqual(takeRows);
        });

        it('still drops a list the pass created when the pass is undone', async () => {
            const clipId = await startLiveTake();
            await stopRecording(12);
            transportStore.set({ ...transportStore.value!, isRecording: false });
            flushAutomergeStorageWrites();
            expect(hasList(clipId)).toEqual({ cc: false, pitchBend: false });

            beginOverdub(6);
            sendLive(6.5, 0xb0, 1, 90);
            await endOverdub(8, 2);
            expect(hasList(clipId)).toEqual({ cc: true, pitchBend: false });

            await undo();
            flushAutomergeStorageWrites();
            expect(hasList(clipId)).toEqual({ cc: false, pitchBend: false });
        });
    });

    describe('stopping the transport while the pass is still landing', () => {
        it('does not settle the stop before the pass has landed, so Undo undoes the pass and not the take', async () => {
            const clipId = await recordFirstTake();
            const takeRows = readRows(clipId);
            const held = await holdSnapshotTransaction();
            playOverdubPass();

            let stopped = false;
            const stopping = stopPlayback().then(() => {
                stopped = true;
            });
            // The stop's own work is main-thread microtasks; a macrotask later it has run all it can.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            const settledEarly = stopped;
            const idleEarly = isTransportIdle();
            held.release();

            expect(settledEarly).toBe(false);
            expect(idleEarly).toBe(false);
            await held.settled;
            await stopping;
            flushAutomergeStorageWrites();
            expect(isTransportIdle()).toBe(true);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(2);

            await undo();
            flushAutomergeStorageWrites();
            expect(readRows(clipId)).toEqual(takeRows);
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);
        });

        it('counts the landed pass as a settled take, as the commit of a take is', async () => {
            await recordFirstTake();
            const settledBefore = countSettledTakes();
            playOverdubPass();

            await stopPlayback();

            expect(countSettledTakes()).toBe(settledBefore + 1);
        });

        it('settles an overdub that recorded no rows without counting a take', async () => {
            await recordFirstTake();
            const settledBefore = countSettledTakes();
            beginOverdub(6);

            await stopPlayback();

            expect(countSettledTakes()).toBe(settledBefore);
            expect(isTransportIdle()).toBe(true);
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
