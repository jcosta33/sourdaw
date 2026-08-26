import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { readClipSatelliteEntry, serializeClipSatelliteEntries } from '../../../stores/clipSatelliteState';
import { setAllEnvelopes, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { trackStore } from '../../../stores/trackStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function makeAudioBuffer(channelData: Float32Array, sampleRate: number): AudioBuffer {
    return {
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
        duration: channelData.length / sampleRate,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    } as unknown as AudioBuffer;
}

describe('handleSplitClip atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({
            id: 'clip-1',
            name: 'Intro',
            trackId: 'track-1',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
        });
        const track = TrackDummy.create({ id: 'track-1', name: 'Keys', kind: 'midi', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'clip-1': [
                    { id: 'note-left', pitch: 60, startBeat: 1, duration: 1, velocity: 80 },
                    { id: 'note-span', pitch: 64, startBeat: 3, duration: 3, velocity: 90 },
                    { id: 'note-right', pitch: 67, startBeat: 6, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        warpStates.clear();
        setAllEnvelopes({});
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        warpStates.clear();
        setAllEnvelopes({});
        vi.restoreAllMocks();
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits and losslessly round-trips clip geometry and MIDI identities through undo and redo', async () => {
        const beforeNotes = structuredClone(midiStore.value!.notesByClipId['clip-1']);
        const result = await executeAppActionBatch([{ type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result).toMatchObject({ status: 'committed' });
        const splitClips = trackStore.value!.tracks[0]!.clips;
        const rightClip = splitClips.find((clip) => clip.id !== 'clip-1')!;
        const splitNotes = structuredClone(midiStore.value!.notesByClipId);
        expect(splitClips).toMatchObject([
            { id: 'clip-1', name: 'Intro (L)', startBeat: 0, endBeat: 4 },
            { id: rightClip.id, name: 'Intro (R)', startBeat: 4, endBeat: 8 },
        ]);
        expect(splitNotes['clip-1']).toMatchObject([
            { id: 'note-left', startBeat: 1, duration: 1 },
            { id: 'note-span', startBeat: 3, duration: 1 },
        ]);
        expect(splitNotes[rightClip.id]).toMatchObject([
            { startBeat: 0, duration: 2 },
            { id: 'note-right', startBeat: 2, duration: 1 },
        ]);

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-1', name: 'Intro', startBeat: 0, endBeat: 8 },
        ]);
        expect(midiStore.value!.notesByClipId['clip-1']).toEqual(beforeNotes);
        expect(midiStore.value!.notesByClipId).not.toHaveProperty(rightClip.id);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-1', name: 'Intro (L)', startBeat: 0, endBeat: 4 },
            { id: rightClip.id, name: 'Intro (R)', startBeat: 4, endBeat: 8 },
        ]);
        expect(midiStore.value!.notesByClipId).toEqual(splitNotes);
    });

    it('keeps the split and undo entry when right-side MIDI changed externally', async () => {
        await executeAppActionBatch([{ type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const rightClip = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1')!;
        const rightNotes = midiStore.value!.notesByClipId[rightClip.id]!;
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                [rightClip.id]: [{ ...rightNotes[0]!, velocity: 12 }, ...rightNotes.slice(1)],
            },
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toHaveLength(2);
        expect(midiStore.value!.notesByClipId[rightClip.id]![0]!.velocity).toBe(12);
    });

    it.each(['tempo-first', 'split-first'] as const)(
        'round-trips an audio split prepared before a tempo write (%s)',
        async (order) => {
            const clip = ClipDummy.create({
                id: 'clip-1',
                name: 'Audio Intro',
                trackId: 'track-1',
                type: 'audio',
                startBeat: 0,
                endBeat: 8,
                audioBufferId: 'audio-buffer-1',
            });
            const track = TrackDummy.create({ id: 'track-1', name: 'Audio', kind: 'audio', clips: [clip] });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            const channelData = new Float32Array(700).fill(1);
            channelData.fill(-1, 251);
            vi.spyOn(audioBufferCache, 'get').mockReturnValue(makeAudioBuffer(channelData, 100));
            const actions =
                order === 'tempo-first'
                    ? ([
                          { type: 'setTempo', payload: { bpm: 60 } },
                          { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } },
                      ] as const)
                    : ([
                          { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } },
                          { type: 'setTempo', payload: { bpm: 60 } },
                      ] as const);

            const result = await executeAppActionBatch(actions, {
                source: 'prompt',
                requireCompensation: true,
            });

            expect(result).toMatchObject({ status: 'committed' });
            expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
                { id: 'clip-1', endBeat: 5 },
                { startBeat: 5, endBeat: 8 },
            ]);
            expect(transportStore.value?.tempo).toBe(60);

            await undo();
            await undo();
            expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-1', startBeat: 0, endBeat: 8 }]);
            expect(transportStore.value?.tempo).toBe(120);

            await redo();
            await redo();
            expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
                { id: 'clip-1', endBeat: 5 },
                { startBeat: 5, endBeat: 8 },
            ]);
            expect(transportStore.value?.tempo).toBe(60);
        }
    );

    it('round-trips gain envelope and warp state exactly through split, undo, and redo', async () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            name: 'Audio Intro',
            trackId: 'track-1',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'audio-buffer-1',
        });
        const track = TrackDummy.create({ id: 'track-1', name: 'Audio', kind: 'audio', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        // Snap fixture shared with the tempo tests above: beat 4 snaps to 5.
        const channelData = new Float32Array(700).fill(1);
        channelData.fill(-1, 251);
        vi.spyOn(audioBufferCache, 'get').mockReturnValue(makeAudioBuffer(channelData, 100));

        setWarpState('clip-1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-left', originalBeat: 3, warpedBeat: 3.25 },
                { id: 'w-right', originalBeat: 7, warpedBeat: 7.5 },
            ],
        });
        setEnvelope('clip-1', {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'p6', beatOffset: 6, gainDb: -12 },
            ],
        });
        const satellitesBefore = serializeClipSatelliteEntries(['clip-1']);

        const result = await executeAppActionBatch([{ type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        expect(result).toMatchObject({ status: 'committed' });
        const rightClip = trackStore.value!.tracks[0]!.clips.find((candidate) => candidate.id !== 'clip-1')!;

        // Split at content seam 5: the left keeps the sub-seam marker, the right
        // inherits the warp setup with the beyond-seam marker; the envelope seam
        // value at clip-relative 5 between (0, 0 dB) and (6, -12 dB) is -10 dB.
        const partitionedLeft = serializeClipSatelliteEntries(['clip-1']);
        expect(readClipSatelliteEntry('clip-1').warpState?.markers).toEqual([
            { id: 'w-left', originalBeat: 3, warpedBeat: 3.25 },
        ]);
        expect(readClipSatelliteEntry(rightClip.id)).toEqual({
            clipId: rightClip.id,
            gainEnvelope: {
                clipId: rightClip.id,
                enabled: true,
                points: [
                    { id: `gep-split-${rightClip.id}-right`, beatOffset: 0, gainDb: -10 },
                    { id: 'p6', beatOffset: 1, gainDb: -12 },
                ],
            },
            warpState: {
                enabled: true,
                markers: [{ id: 'w-right', originalBeat: 7, warpedBeat: 7.5 }],
                stretchMode: 'complex',
                originalTempo: 120,
            },
        });
        expect(readClipSatelliteEntry('clip-1').gainEnvelope?.points).toEqual([
            { id: 'p0', beatOffset: 0, gainDb: 0 },
            { id: `gep-split-${rightClip.id}-left`, beatOffset: 5, gainDb: -10 },
        ]);

        await undo();

        // The source entry is back byte-identically, and the right half's
        // satellites are gone rather than orphaned.
        expect(serializeClipSatelliteEntries(['clip-1'])).toBe(satellitesBefore);
        expect(readClipSatelliteEntry(rightClip.id)).toEqual({
            clipId: rightClip.id,
            gainEnvelope: null,
            warpState: null,
        });

        await redo();

        expect(serializeClipSatelliteEntries(['clip-1'])).toBe(partitionedLeft);
        expect(readClipSatelliteEntry(rightClip.id).gainEnvelope?.points).toEqual([
            { id: `gep-split-${rightClip.id}-right`, beatOffset: 0, gainDb: -10 },
            { id: 'p6', beatOffset: 1, gainDb: -12 },
        ]);
    });
});
