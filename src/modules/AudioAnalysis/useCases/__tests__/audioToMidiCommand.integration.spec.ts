import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as storage from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    addClip,
    createTrack,
    getArrangementHandlers,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, executeAppActionBatch, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { handleAudioToMidi } from '../../handlers/analysis/handleAudioToMidi';
import { audioToMidi } from '../audioToMidi';

const mocks = vi.hoisted(() => ({ getCachedAudioBuffer: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

class NoopArrangementEventBus {
    async emit<TEventName extends string>(_event: TEventName, _payload: unknown): Promise<void> {}
}

function midiOutput() {
    return trackStore.value?.tracks.filter((track) => track.kind === 'midi') ?? [];
}

describe('registered audio-to-MIDI grouped creation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        clearHandlerRegistry();
        registerHandlerMap({
            ...getArrangementHandlers(),
            ...getMidiNoteTransformHandlers(),
            audioToMidi: handleAudioToMidi,
        });
        clearUndoHistory();
        setArrangementEventBus(new NoopArrangementEventBus());
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'audio', kind: 'audio', name: 'Source' })],
        });
        addClip({
            id: 'source',
            trackId: 'audio',
            name: 'Phrase',
            type: 'audio',
            startBeat: 0,
            endBeat: 4,
            audioBufferId: 'buffer',
        });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        const data = Float32Array.from({ length: 44100 }, (_, frame) => (frame >= 11025 && frame < 22050 ? 0.8 : 0));
        mocks.getCachedAudioBuffer.mockReturnValue({
            sampleRate: 44100,
            duration: 1,
            length: data.length,
            getChannelData: () => data,
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it('commits a nonempty result through the registered action and round-trips the complete group', async () => {
        const tracksBefore = structuredClone(trackStore.value);
        const midiBefore = structuredClone(midiStore.value);
        await executeAppAction({ type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } });
        const output = midiOutput();
        expect(output).toHaveLength(1);
        expect(output[0].clips).toHaveLength(1);
        const clipId = output[0].clips[0].id;
        const notes = structuredClone(midiStore.value?.notesByClipId[clipId]);
        expect(notes).toHaveLength(1);
        expect(await undo()).toMatchObject({ headConsumed: true });
        expect(trackStore.value).toEqual(tracksBefore);
        expect(midiStore.value).toEqual(midiBefore);
        await redo();
        expect(midiOutput()[0].clips[0].id).toBe(clipId);
        expect(midiStore.value?.notesByClipId[clipId]).toEqual(notes);
    });

    it('waits outside any parent storage owner for delayed snapshot admission', async () => {
        let release!: () => void;
        let entered!: () => void;
        const admission = new Promise<void>((resolve) => {
            release = resolve;
        });
        const waiting = new Promise<void>((resolve) => {
            entered = resolve;
        });
        vi.spyOn(storage, 'waitForAutomergeSnapshotTransaction').mockImplementation(() => {
            expect(storage.getCurrentAutomergeStorageMutationOwner()).toBeUndefined();
            entered();
            return admission;
        });
        const conversion = executeAppAction({ type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } });
        await waiting;
        expect(midiOutput()).toHaveLength(0);
        release();
        await conversion;
        expect(midiOutput()[0].clips).toHaveLength(1);
        expect(midiStore.value?.notesByClipId[midiOutput()[0].clips[0].id]).toHaveLength(1);
    });

    it('rejects a frozen existing destination before publishing any partial result', async () => {
        const state = trackStore.value!;
        setTrackStoreState({
            ...state,
            tracks: [...state.tracks, { ...createTrack({ id: 'midi', kind: 'midi', name: 'Frozen' }), frozen: true }],
        });
        const tracksBefore = structuredClone(trackStore.value);
        const midiBefore = structuredClone(midiStore.value);
        expect(await audioToMidi({ clipId: 'source', trackId: 'midi' })).toBe(false);
        expect(trackStore.value).toEqual(tracksBefore);
        expect(midiStore.value).toEqual(midiBefore);
    });

    it('rejects mixing runtime conversion into a project batch without entering nested dispatch', async () => {
        const before = structuredClone(trackStore.value);
        const result = await executeAppActionBatch([
            { type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } },
            { type: 'renameTrack', payload: { trackId: 'audio', name: 'Changed' } },
        ]);
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: audioToMidi',
        });
        expect(trackStore.value).toEqual(before);
        expect(midiOutput()).toHaveLength(0);
    });
});
