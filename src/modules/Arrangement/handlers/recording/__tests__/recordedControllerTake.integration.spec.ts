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
        transportStore.set({ ...transportStore.value!, isRecording: false, playheadPosition: 4 });
    });

    afterEach(() => {
        transportStore.set({ ...transportStore.value!, isRecording: false });
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
            let worstFlushMs = 0;

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
                if (index % 3 === 2) {
                    const startedAt = performance.now();
                    flushAutomergeStorageWrites();
                    worstFlushMs = Math.max(worstFlushMs, performance.now() - startedAt);
                    expect(midiStore.value?.ccByClipId[clipId]).toBeUndefined();
                    expect(midiStore.value?.pitchBendByClipId[clipId]).toBeUndefined();
                }
            }
            expect(worstFlushMs).toBeLessThan(50);

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
