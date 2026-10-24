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

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
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
    getWebMidiInputHandlers,
    initWebMidi,
    planRecordedControllers,
    projectClipControllerEvents,
    resetMidiState,
    selectMidiInput,
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
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';

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
            { controller: 64, value: 0, beat: 4, channel: 0 },
        ]);
        // Recorded with MPE off, so the row is scoped to the channel the wheel arrived on.
        expect(rowsOf(recordedBend)).toEqual([{ value: 1000, beat: 1, channel: 0, channelScoped: true }]);
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

        /** A clip spanning the take, for planning rows of a clip no longer on the timeline. */
        const spanOf = (clipId: string) => ({ id: clipId, startBeat: 4, endBeat: 8 });

        const pedalsOf = (clipId: string) =>
            (midiStore.value?.ccByClipId[clipId] ?? []).map(({ controller, value, beat, channel }) => ({
                controller,
                value,
                beat,
                channel,
            }));

        /**
         * Stop the transport's recording as an overdub pass ends and wait for its rows. They land
         * through one app action when the transport stops, so the pass adds exactly one undo step.
         */
        async function endOverdubPass(): Promise<void> {
            const entriesBefore = undoHistoryStore.value?.past.length ?? 0;
            transportStore.set({ ...transportStore.value!, isRecording: false });
            await vi.waitFor(() => {
                expect(undoHistoryStore.value?.past.length ?? 0).toBe(entriesBefore + 1);
            });
            flushAutomergeStorageWrites();
        }

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

        // Playback and export read a MIDI clip's controllers without a note list
        // (`controllerTakePlayback.integration.spec.ts` in Transport and
        // `controllerTakeExport.integration.spec.ts` in AudioEngine drive them), so
        // the commit never writes a placeholder list: a peer recording the clip's
        // first note concurrently would race it for the same key.
        describe('a take of controllers and no notes', () => {
            it('commits the controllers without creating a note list, and undo and redo carry exactly the rows', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 64, 127);
                sendLive(5.5, 0xb0, 64, 0);

                await stopRecording(8);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                const committed = pedalsOf(clipId);
                expect(committed).toEqual([
                    { controller: 64, value: 127, beat: 0.5, channel: 0 },
                    { controller: 64, value: 0, beat: 1.5, channel: 0 },
                ]);
                expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();

                await undo();
                flushAutomergeStorageWrites();
                expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
                expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();

                await redo();
                flushAutomergeStorageWrites();
                expect(pedalsOf(clipId)).toEqual(committed);
                expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
            });

            it('creates no note list for a take that recorded nothing at all', async () => {
                const clipId = await startLiveTake();

                await stopRecording(8);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                expect(midiStore.value?.notesByClipId[clipId]).toBeUndefined();
            });

            it('keeps the notes a take recorded beside its controllers', async () => {
                const clipId = await startLiveTake();
                appendRecordedMidiNote({
                    clipId,
                    note: { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                });
                sendLive(4.5, 0xb0, 64, 127);

                await stopRecording(8);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                expect(midiStore.value?.notesByClipId[clipId]?.map(({ id }) => id)).toEqual(['note-1']);
            });
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
                await endOverdubPass();

                // The commit that landed while the overdub's pedal was down closes it on the
                // clip's end; the overdub's own release follows when its take ends.
                expect(pedalsOf(clipId)).toEqual([
                    { controller: 1, value: 55, beat: 0.5, channel: 0 },
                    { controller: 64, value: 127, beat: 2.5, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 0 },
                    { controller: 64, value: 0, beat: 3, channel: 0 },
                ]);
            });

            it('writes nothing for a commit the owning track being gone refuses, and drops the buffer', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 1, 55);
                sendLive(5, 0xe0, 104, 71);
                expect(planRecordedControllers({ clip: spanOf(clipId) }).cc).toHaveLength(1);
                const held = await holdSnapshotTransaction();
                transportStore.set({ ...transportStore.value!, isRecording: false });
                // The refused commit rolls its transaction back, so the stored rows
                // end up unchanged either way: a write that landed and was undone
                // still published its rows to the store's subscribers. Only a
                // notification carrying the removed clip's rows counts, so an
                // unrelated store emission cannot redden the case.
                let notificationsCarryingTheClipRows = 0;
                const stopCounting = midiStore.subscribe(() => {
                    const carriesRows =
                        (midiStore.value?.ccByClipId[clipId]?.length ?? 0) > 0 ||
                        (midiStore.value?.pitchBendByClipId[clipId]?.length ?? 0) > 0;
                    if (carriesRows) {
                        notificationsCarryingTheClipRows += 1;
                    }
                });
                const stopping = stopRecording(8);

                trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
                held.release();
                await held.settled;
                await stopping;
                stopCounting();
                flushAutomergeStorageWrites();

                expect(notificationsCarryingTheClipRows).toBe(0);
                expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
                expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();
                expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
                expect(planRecordedControllers({ clip: spanOf(clipId) })).toEqual({ cc: [], pitchBend: [] });
            });
        });

        describe('describing the commit', () => {
            it('only reads the buffer, and names the rows the write then lands', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 64, 127);
                sendLive(5, 0xe0, 104, 71);
                // The clip as the commit lands it: the lift closing the held pedal sits on its end.
                const liveClip = trackStore
                    .value!.tracks.flatMap((track) => track.clips)
                    .find(({ id }) => id === clipId)!;
                const clip = { ...liveClip, endBeat: 8 };
                const { commitRecording: handler } = getArrangementHandlers();
                const action = { type: 'commitRecording' as const, payload: { clip } };

                const described = handler.describe(action);
                const describedAgain = handler.describe(action);

                expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
                expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();
                expect(planRecordedControllers({ clip }).cc).toHaveLength(2);
                expect(describedAgain).toEqual(described);
                const redo = described.redoAction;
                if (redo?.type !== 'restoreRecording') {
                    throw new Error('expected a restoreRecording redo');
                }
                // The held pedal's press and the lift that closes it on the clip's end.
                expect(redo.payload.midiCcSnapshot).toHaveLength(2);
                expect(redo.payload.midiPitchBendSnapshot).toHaveLength(1);

                await stopRecording(8);
                flushAutomergeStorageWrites();

                expect(midiStore.value?.ccByClipId[clipId]).toEqual(redo.payload.midiCcSnapshot);
                expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual(redo.payload.midiPitchBendSnapshot);
            });
        });

        describe('a clip that already holds controller rows', () => {
            it('commits and replays the stored rows followed by the take rows', async () => {
                const clipId = await startLiveTake();
                const stored = addMidiCC(clipId, 64, 127, 0.25, 0);
                flushAutomergeStorageWrites();
                sendLive(5, 0xb0, 1, 55);
                sendLive(5.5, 0xb0, 1, 66);

                await stopRecording(8);
                flushAutomergeStorageWrites();

                const committed = midiStore.value?.ccByClipId[clipId];
                expect(committed?.map(({ controller, value, beat }) => ({ controller, value, beat }))).toEqual([
                    { controller: 64, value: 127, beat: 0.25 },
                    { controller: 1, value: 55, beat: 1 },
                    { controller: 1, value: 66, beat: 1.5 },
                ]);
                expect(committed?.[0]).toEqual(stored);

                await undo();
                flushAutomergeStorageWrites();
                expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();

                await redo();
                flushAutomergeStorageWrites();
                expect(midiStore.value?.ccByClipId[clipId]).toEqual(committed);
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
                    { controller: 66, value: 0, beat: 4, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 3 },
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

                expect(pedalsOf(provisional.id)).toEqual([
                    { controller: 64, value: 127, beat: 0, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 0 },
                ]);
            });

            // Switching the input leaves the target track alone, so only the device reset can clear the pedal.
            it('loses a held pedal when another input device is selected', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                const otherInput = Object.assign(new EventTarget(), {
                    id: 'other-input',
                    name: 'Other input',
                    manufacturer: 'Test',
                });
                liveMidi.inputs.set(otherInput.id, otherInput);
                try {
                    selectMidiInput(otherInput.id);
                    const [provisional] = startRecording(4);
                    if (!provisional) {
                        throw new Error('expected a provisional recording clip');
                    }
                    transportStore.set({ ...transportStore.value!, isRecording: true });

                    await notesOnlyTake(provisional.id);

                    expect(midiStore.value?.ccByClipId[provisional.id]).toBeUndefined();
                } finally {
                    selectMidiInput(liveMidi.input.id);
                    liveMidi.inputs.delete(otherInput.id);
                }
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

            it('keeps a held pedal when the already-armed track is selected again', async () => {
                injectDependencies(selectTrack, { eventBus: { emit: () => Promise.resolve() } });
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                selectTrack(TRACK_ID);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });

                await notesOnlyTake(provisional.id);

                expect(pedalsOf(provisional.id)).toEqual([
                    { controller: 64, value: 127, beat: 0, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 0 },
                ]);
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

            it('keeps the starting pedal when the take lifts it later than beat 0', async () => {
                setWebMidiRuntimeEventBus({ eventBus: { emit: () => Promise.resolve(), on: () => () => {} } });
                await initWebMidi();
                setMidiInputTrack(TRACK_ID);
                sendLive(4, 0xb0, 64, 127);
                const [provisional] = startRecording(4);
                if (!provisional) {
                    throw new Error('expected a provisional recording clip');
                }
                transportStore.set({ ...transportStore.value!, isRecording: true });
                sendLive(6, 0xb0, 64, 0);

                await notesOnlyTake(provisional.id);

                expect(pedalsOf(provisional.id)).toEqual([
                    { controller: 64, value: 127, beat: 0, channel: 0 },
                    { controller: 64, value: 0, beat: 2, channel: 0 },
                ]);
            });
        });

        describe('a pedal the take leaves engaged', () => {
            const liftsAtClosingLine = (clipId: string, clipEndBeat: number) => {
                const clip = trackStore.value!.tracks.flatMap((track) => track.clips).find(({ id }) => id === clipId)!;
                return projectClipControllerEvents({
                    controlChanges: midiStore.value?.ccByClipId[clipId] ?? [],
                    clip,
                    fromBeat: clipEndBeat - 1,
                    toBeat: clipEndBeat + 1,
                }).map(({ controller, value, beat, closesClip }) => ({ controller, value, beat, closesClip }));
            };

            it('lifts a pedal still down at user stop on the clip closing line, and replays the lift through undo and redo', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 64, 127);

                await stopRecording(8);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                const expected = [
                    { controller: 64, value: 127, beat: 0.5, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 0 },
                ];
                expect(pedalsOf(clipId)).toEqual(expected);
                expect(liftsAtClosingLine(clipId, 8)).toEqual([
                    { controller: 64, value: 0, beat: 8, closesClip: true },
                ]);

                await undo();
                await redo();
                flushAutomergeStorageWrites();
                expect(pedalsOf(clipId)).toEqual(expected);
            });

            it('lifts every engaged pedal, each on its own channel', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 66, 100);
                sendLive(5, 0xb0, 67, 30);
                sendLive(5.5, 0xb2, 64, 1);

                await stopRecording(8);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                expect(pedalsOf(clipId)).toEqual([
                    { controller: 66, value: 100, beat: 0.5, channel: 0 },
                    { controller: 67, value: 30, beat: 1, channel: 0 },
                    { controller: 64, value: 1, beat: 1.5, channel: 2 },
                    { controller: 66, value: 0, beat: 4, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 2 },
                ]);
            });

            it('lifts a pedal still down at punch-out in the commit that runs while the transport is still recording', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 64, 127);

                await stopRecording(8);
                flushAutomergeStorageWrites();

                const committed = [
                    { controller: 64, value: 127, beat: 0.5, channel: 0 },
                    { controller: 64, value: 0, beat: 4, channel: 0 },
                ];
                expect(pedalsOf(clipId)).toEqual(committed);

                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();
                expect(pedalsOf(clipId)).toEqual(committed);
            });

            it('adds no lift to a pedal the take lifted itself', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 64, 127);
                sendLive(5.5, 0xb0, 64, 0);

                await stopRecording(8);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();

                expect(pedalsOf(clipId)).toEqual([
                    { controller: 64, value: 127, beat: 0.5, channel: 0 },
                    { controller: 64, value: 0, beat: 1.5, channel: 0 },
                ]);
            });

            describe('in a clip the recorder did not open', () => {
                const takeFirstPass = async (): Promise<string> => {
                    const clipId = await startLiveTake();
                    sendLive(4.5, 0xb0, 1, 55);
                    await stopRecording(12);
                    transportStore.set({ ...transportStore.value!, isRecording: false });
                    flushAutomergeStorageWrites();
                    return clipId;
                };

                const beginOverdub = (atBeat: number): void => {
                    transportStore.set({ ...transportStore.value!, overdubEnabled: true });
                    expect(startRecording(atBeat)).toEqual([]);
                    transportStore.set({ ...transportStore.value!, isRecording: true });
                };

                it('lifts a pedal still down at the stop beat on the clip closing line, not mid-clip', async () => {
                    const clipId = await takeFirstPass();
                    beginOverdub(6);
                    sendLive(6.5, 0xb0, 64, 127);

                    await stopRecording(8);
                    await endOverdubPass();

                    expect(pedalsOf(clipId)).toEqual([
                        { controller: 1, value: 55, beat: 0.5, channel: 0 },
                        { controller: 64, value: 127, beat: 2.5, channel: 0 },
                        { controller: 64, value: 0, beat: 8, channel: 0 },
                    ]);
                    expect(liftsAtClosingLine(clipId, 12)).toEqual([
                        { controller: 64, value: 0, beat: 12, closesClip: true },
                    ]);
                });

                it('keeps a loop overdub press late in one pass held to the closing line when the stop lands after the wrap', async () => {
                    const clipId = await takeFirstPass();
                    transportStore.set({ ...transportStore.value!, isLooping: true, loopStart: 4, loopEnd: 12 });
                    beginOverdub(6);
                    sendLive(10, 0xb0, 64, 127);
                    sendLive(6, 0xb0, 1, 60);

                    await stopRecording(6);
                    await endOverdubPass();

                    // The stop beat is the wrapped playhead, before the press: a lift there would cancel it.
                    expect(pedalsOf(clipId)).toEqual([
                        { controller: 1, value: 55, beat: 0.5, channel: 0 },
                        { controller: 64, value: 127, beat: 6, channel: 0 },
                        { controller: 1, value: 60, beat: 2, channel: 0 },
                        { controller: 64, value: 0, beat: 8, channel: 0 },
                    ]);
                    expect(liftsAtClosingLine(clipId, 12)).toEqual([
                        { controller: 64, value: 0, beat: 12, closesClip: true },
                    ]);
                });

                it('adds no lift to a pedal the overdub lifted itself', async () => {
                    const clipId = await takeFirstPass();
                    beginOverdub(6);
                    sendLive(6.5, 0xb0, 64, 127);
                    sendLive(7, 0xb0, 64, 0);

                    await stopRecording(8);
                    await endOverdubPass();

                    expect(pedalsOf(clipId)).toEqual([
                        { controller: 1, value: 55, beat: 0.5, channel: 0 },
                        { controller: 64, value: 127, beat: 2.5, channel: 0 },
                        { controller: 64, value: 0, beat: 3, channel: 0 },
                    ]);
                });
            });
        });

        describe('an overdub into a clip an earlier take already committed', () => {
            it('writes the rows the overdub records when it ends', async () => {
                const clipId = await startLiveTake();
                sendLive(4.5, 0xb0, 1, 55);
                await stopRecording(12);
                transportStore.set({ ...transportStore.value!, isRecording: false });
                flushAutomergeStorageWrites();
                expect(pedalsOf(clipId)).toEqual([{ controller: 1, value: 55, beat: 0.5, channel: 0 }]);

                transportStore.set({ ...transportStore.value!, overdubEnabled: true });
                expect(startRecording(6)).toEqual([]);
                transportStore.set({ ...transportStore.value!, isRecording: true });
                sendLive(6.5, 0xb0, 64, 127);
                sendLive(7, 0xb0, 64, 0);
                await stopRecording(8);
                await endOverdubPass();

                expect(pedalsOf(clipId)).toEqual([
                    { controller: 1, value: 55, beat: 0.5, channel: 0 },
                    { controller: 64, value: 127, beat: 2.5, channel: 0 },
                    { controller: 64, value: 0, beat: 3, channel: 0 },
                ]);
            });
        });
    });
});
