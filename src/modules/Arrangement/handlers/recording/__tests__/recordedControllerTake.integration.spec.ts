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
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import { setMidiLearnDependencies } from '#/modules/ControlSurface/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    addMidiCC,
    addPitchBend,
    appendRecordedMidiNote,
    destroyWebMidi,
    initWebMidi,
    planRecordedControllers,
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
        transportStore.set({
            ...transportStore.value!,
            isRecording: false,
            overdubEnabled: false,
            playheadPosition: 4,
        });
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

    describe('buffering the take until it commits', () => {
        async function startLiveTake(): Promise<string> {
            setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
            await initWebMidi();
            setMidiInputTrack(TRACK_ID);
            const [provisional] = startRecording(4);
            if (!provisional) {
                throw new Error('expected a provisional recording clip');
            }
            transportStore.set({ ...transportStore.value!, isRecording: true });
            return provisional.id;
        }

        const sendLive = (beat: number, ...bytes: number[]): void => {
            transportStore.set({ ...transportStore.value!, playheadPosition: beat });
            liveMidi.input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }));
        };

        const pedalsOf = (clipId: string) =>
            (midiStore.value?.ccByClipId[clipId] ?? []).map(({ controller, value, beat, channel }) => ({
                controller,
                value,
                beat,
                channel,
            }));

        it('writes nothing to the store during a long take and lands every row, in order, at the commit', async () => {
            const MESSAGES = 6000;
            const clipId = await startLiveTake();
            const expectedCc: { value: number; beat: number }[] = [];
            const expectedBend: { value: number; beat: number }[] = [];
            let storeWritesDuringTake = 0;
            const stopCounting = midiStore.subscribe(() => {
                storeWritesDuringTake += 1;
            });

            for (let index = 0; index < MESSAGES; index++) {
                const beat = 4 + index * 0.01;
                if (index % 2 === 0) {
                    const value = (index / 2) % 128;
                    sendLive(beat, 0xb0, 1, value);
                    expectedCc.push({ value, beat: index * 0.01 });
                } else {
                    const position = (index * 37) % 16384;
                    sendLive(beat, 0xe0, position & 0x7f, position >> 7);
                    expectedBend.push({ value: position - 8192, beat: index * 0.01 });
                }
                if (index % 1000 === 999) {
                    expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
                    expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();
                }
            }
            stopCounting();
            expect(storeWritesDuringTake).toBe(0);
            expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
            expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();

            await stopRecording(70);
            flushAutomergeStorageWrites();

            const recordedCc = midiStore.value?.ccByClipId[clipId] ?? [];
            const recordedBend = midiStore.value?.pitchBendByClipId[clipId] ?? [];
            expect(recordedCc.map(({ controller, value, channel }) => ({ controller, value, channel }))).toEqual(
                expectedCc.map(({ value }) => ({ controller: 1, value, channel: 0 }))
            );
            expect(recordedBend.map(({ value, channel }) => ({ value, channel }))).toEqual(
                expectedBend.map(({ value }) => ({ value, channel: 0 }))
            );
            const microBeat = (beat: number): number => Math.round(beat * 1e6);
            expect(recordedCc.map(({ beat }) => microBeat(beat))).toEqual(
                expectedCc.map(({ beat }) => microBeat(beat))
            );
            expect(recordedBend.map(({ beat }) => microBeat(beat))).toEqual(
                expectedBend.map(({ beat }) => microBeat(beat))
            );
            expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

            await undo();
            flushAutomergeStorageWrites();
            expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
            expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();

            await redo();
            flushAutomergeStorageWrites();
            expect(midiStore.value?.ccByClipId[clipId]).toEqual(recordedCc);
            expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual(recordedBend);
        }, 120_000);

        // A punch-out stops the MIDI take while the audio recording is still
        // awaited, so the transport reports recording after the commit began.
        it('commits the buffered rows into the redo snapshot when the take stops before the transport does', async () => {
            const clipId = await startLiveTake();
            sendLive(4.5, 0xb0, 64, 127);
            sendLive(5, 0xe0, 104, 71);
            sendLive(5.5, 0xb0, 64, 0);
            expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();

            await stopRecording(8);
            // Still recording: a message from the audio flush window belongs to no take.
            sendLive(7.5, 0xb0, 1, 99);
            transportStore.set({ ...transportStore.value!, isRecording: false });
            flushAutomergeStorageWrites();

            const committed = pedalsOf(clipId);
            expect(committed).toEqual([
                { controller: 64, value: 127, beat: 0.5, channel: 0 },
                { controller: 64, value: 0, beat: 1.5, channel: 0 },
            ]);
            const committedBend = midiStore.value?.pitchBendByClipId[clipId];
            expect(committedBend).toHaveLength(1);

            await undo();
            flushAutomergeStorageWrites();
            expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();

            await redo();
            flushAutomergeStorageWrites();
            expect(pedalsOf(clipId)).toEqual(committed);
            expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual(committedBend);
        });

        it('writes nothing for a discarded take and starts the next take empty', async () => {
            const discardedClipId = await startLiveTake();
            sendLive(4.5, 0xb0, 1, 55);
            sendLive(5, 0xe0, 104, 71);
            trackStore.set({
                ...trackStore.value!,
                tracks: trackStore.value!.tracks.map((track) => ({ ...track, clips: [] })),
            });
            transportStore.set({ ...transportStore.value!, isRecording: false });
            await stopRecording(8);
            flushAutomergeStorageWrites();
            expect(midiStore.value?.ccByClipId[discardedClipId]).toBeUndefined();
            expect(midiStore.value?.pitchBendByClipId[discardedClipId]).toBeUndefined();

            const [next] = startRecording(4);
            if (!next) {
                throw new Error('expected a provisional recording clip');
            }
            transportStore.set({ ...transportStore.value!, isRecording: true });
            sendLive(4.25, 0xb0, 1, 33);
            await stopRecording(8);
            flushAutomergeStorageWrites();

            expect(pedalsOf(next.id)).toEqual([{ controller: 1, value: 33, beat: 0.25, channel: 0 }]);
            expect(midiStore.value?.pitchBendByClipId[next.id]).toBeUndefined();
            expect(midiStore.value?.ccByClipId[discardedClipId]).toBeUndefined();
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

        describe('a commit that waits behind a snapshot transaction', () => {
            it('commits the first take with its own controllers when the next take began while it waited', async () => {
                const clipA = await startLiveTake();
                sendLive(4.5, 0xb0, 1, 55);
                sendLive(5, 0xe0, 104, 71);
                const held = await holdSnapshotTransaction();
                transportStore.set({ ...transportStore.value!, isRecording: false });
                const stoppingA = stopRecording(8);

                const [provisionalB] = startRecording(8);
                if (!provisionalB) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });
                sendLive(8.5, 0xb0, 1, 99);
                held.release();
                await held.settled;
                await stoppingA;
                flushAutomergeStorageWrites();

                expect(pedalsOf(clipA)).toEqual([{ controller: 1, value: 55, beat: 0.5, channel: 0 }]);
                expect(midiStore.value?.pitchBendByClipId[clipA]).toHaveLength(1);
                expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

                transportStore.set({ ...transportStore.value!, isRecording: false });
                await stopRecording(12);
                flushAutomergeStorageWrites();

                expect(pedalsOf(provisionalB.id)).toEqual([{ controller: 1, value: 99, beat: 0.5, channel: 0 }]);
                expect(pedalsOf(clipA)).toEqual([{ controller: 1, value: 55, beat: 0.5, channel: 0 }]);
                expect(undoHistoryStore.value?.past ?? []).toHaveLength(2);
            });

            it('keeps the rows an overdub take records into the clip after the first take commit lands', async () => {
                transportStore.set({ ...transportStore.value!, overdubEnabled: true });
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 1, 55);
                const held = await holdSnapshotTransaction();
                transportStore.set({ ...transportStore.value!, isRecording: false });
                const stoppingFirst = stopRecording(8);

                // The overdub begins inside the clip the first take opened.
                expect(startRecording(6)).toEqual([]);
                transportStore.set({ ...transportStore.value!, isRecording: true });
                sendLive(6.5, 0xb0, 64, 127);
                held.release();
                await held.settled;
                await stoppingFirst;
                sendLive(7, 0xb0, 64, 0);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                expect(pedalsOf(clipId)).toEqual([
                    { controller: 1, value: 55, beat: 0.5, channel: 0 },
                    { controller: 64, value: 127, beat: 2.5, channel: 0 },
                    { controller: 64, value: 0, beat: 3, channel: 0 },
                ]);
            });

            it('writes nothing for a commit the owning track being gone refuses, and drops the buffer', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 1, 55);
                sendLive(5, 0xe0, 104, 71);
                expect(planRecordedControllers({ clipId }).cc).toHaveLength(1);
                const held = await holdSnapshotTransaction();
                transportStore.set({ ...transportStore.value!, isRecording: false });
                const stopping = stopRecording(8);

                trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
                held.release();
                await held.settled;
                await stopping;
                flushAutomergeStorageWrites();

                expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
                expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();
                expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
                expect(planRecordedControllers({ clipId })).toEqual({ cc: [], pitchBend: [] });
            });
        });

        describe('describing the commit', () => {
            it('only reads the buffer, and names the rows the write then lands', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 64, 127);
                sendLive(5, 0xe0, 104, 71);
                const clip = trackStore.value!.tracks.flatMap((track) => track.clips).find(({ id }) => id === clipId)!;
                const { commitRecording: handler } = getArrangementHandlers();
                const action = { type: 'commitRecording' as const, payload: { clip } };

                const described = handler.describe(action);
                const describedAgain = handler.describe(action);

                expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
                expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();
                expect(planRecordedControllers({ clipId }).cc).toHaveLength(1);
                expect(describedAgain).toEqual(described);
                const redo = described.redoAction;
                if (redo?.type !== 'restoreRecording') {
                    throw new Error('expected a restoreRecording redo');
                }
                expect(redo.payload.midiCcSnapshot).toHaveLength(1);
                expect(redo.payload.midiPitchBendSnapshot).toHaveLength(1);

                await stopRecording(8);
                flushAutomergeStorageWrites();

                expect(midiStore.value?.ccByClipId[clipId]).toEqual(redo.payload.midiCcSnapshot);
                expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual(redo.payload.midiPitchBendSnapshot);
            });
        });

        describe('a pedal a learned mapping owns', () => {
            afterEach(() => {
                midiLearnStore.set({ ...midiLearnStore.value!, mappings: [] });
            });

            it('is not seeded as a press at beat 0 when its lift is kept out of the take', async () => {
                const setTrackPanArrangement = vi.fn();
                setMidiLearnDependencies({
                    setTrackGainArrangement: vi.fn(),
                    setTrackPanArrangement,
                    setDeviceParameter: vi.fn(),
                    setFermenterMappedParam: vi.fn(),
                    recordAutomationValue: vi.fn(),
                    getTransportIsPlaying: () => false,
                    getTransportPlayheadPosition: () => 0,
                    getAllTracks: () => [],
                });
                midiLearnStore.set({
                    ...midiLearnStore.value!,
                    mappings: [
                        {
                            id: 'mapping-pedal-pan',
                            channel: 0,
                            cc: 64,
                            targetType: 'trackPan',
                            trackId: TRACK_ID,
                            minValue: -50,
                            maxValue: 50,
                        },
                    ],
                });
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });
                appendRecordedMidiNote({
                    clipId: provisional.id,
                    note: { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                });
                sendLive(5, 0xb0, 64, 0);
                await stopRecording(8);
                flushAutomergeStorageWrites();

                expect(setTrackPanArrangement).toHaveBeenCalledTimes(2);
                expect(pedalsOf(provisional.id).filter(({ controller }) => controller === 64)).toEqual([]);
            });
        });

        describe('pedals already held when the take begins', () => {
            const notesOnlyTake = async (clipId: string): Promise<void> => {
                appendRecordedMidiNote({
                    clipId,
                    note: { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                });
                await stopRecording(8);
                flushAutomergeStorageWrites();
            };

            it('puts a sustain pressed before the take at clip beat 0 on its channel, and replays through undo and redo', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb3, 64, 127);
                sendLive(4, 0xb0, 66, 90);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });

                await notesOnlyTake(provisional.id);

                const expected = [
                    { controller: 66, value: 90, beat: 0, channel: 0 },
                    { controller: 64, value: 127, beat: 0, channel: 3 },
                ];
                expect(pedalsOf(provisional.id)).toEqual(expected);

                await undo();
                await redo();
                flushAutomergeStorageWrites();
                expect(pedalsOf(provisional.id)).toEqual(expected);
            });

            it('records nothing extra for a pedal that was lifted before the take', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                sendLive(4, 0xb0, 64, 0);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });

                await notesOnlyTake(provisional.id);

                expect(midiStore.value?.ccByClipId[provisional.id]).toBeUndefined();
            });

            it('keeps a pedal held through the transport reset a stop, pause or seek runs', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                resetMidiState();
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });

                await notesOnlyTake(provisional.id);

                expect(pedalsOf(provisional.id)).toEqual([{ controller: 64, value: 127, beat: 0, channel: 0 }]);
            });

            it('loses a held pedal when the input device is reset', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                destroyWebMidi();
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });

                await notesOnlyTake(provisional.id);

                expect(midiStore.value?.ccByClipId[provisional.id]).toBeUndefined();
            });

            it('seeds no pedal that was pressed while another track was the input target', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack('track-other');
                sendLive(4, 0xb0, 64, 127);
                setMidiInputTrack(TRACK_ID);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });

                await notesOnlyTake(provisional.id);

                expect(midiStore.value?.ccByClipId[provisional.id]).toBeUndefined();
            });

            it('adds no duplicate when the take records the pedal at beat 0 itself', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });
                sendLive(4, 0xb0, 64, 0);

                await notesOnlyTake(provisional.id);

                expect(pedalsOf(provisional.id)).toEqual([{ controller: 64, value: 0, beat: 0, channel: 0 }]);
            });
        });
    });
});
