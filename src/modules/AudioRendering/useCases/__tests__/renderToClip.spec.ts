import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultTransportState,
    tempoMapStore,
    type TempoMapStoreState,
    transportStore,
} from '#/modules/Transport/stores';

import { renderToClip, type RenderToClipInput } from '../renderToClip';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

// The real `resolveBouncedClipEndBeat` and the real Transport tempo readers run:
// only the project mutations around them are replaced.
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
    removeClip: vi.fn(),
    removeTrack: vi.fn(),
    captureRetiredTakeLanes: vi.fn(() => []),
    restoreTakesForClip: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: mocks.pushUndoEntry,
}));

const SAMPLE_RATE = 48_000;

type PlacedEnds = { first: number; redo: number };

describe('renderToClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetTempo();
    });

    afterEach(() => {
        resetTempo();
    });

    it('writes the buffer into the cache, creates a clip on the target track, and records an undo entry', () => {
        const buffer = { length: 44100, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
        mocks.addClip.mockReturnValue({ id: 'clip-new', trackId: 'track-1' });

        const result = renderToClip({
            targetTrackId: 'track-1',
            startBeat: 4,
            endBeat: 12,
            tailSeconds: 0,
            buffer,
            name: 'Rendered Mixdown',
        });

        expect(result).not.toBeNull();
        expect(result?.trackId).toBe('track-1');
        expect(result?.clipId).toBe('clip-new');
        expect(typeof result?.audioBufferId).toBe('string');
        expect(result?.audioBufferId.startsWith('rendered-')).toBe(true);

        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({ buffer, bufferId: result?.audioBufferId });
        expect(mocks.addClip).toHaveBeenCalledWith({
            trackId: 'track-1',
            startBeat: 4,
            endBeat: 12,
            name: 'Rendered Mixdown',
            type: 'audio',
            audioBufferId: result?.audioBufferId,
        });
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Render to clip', expect.any(Function), expect.any(Function), {
            restoresBufferIds: [result?.audioBufferId],
        });
    });

    it('creates a new audio track when targetTrackId is "new"', () => {
        const buffer = { length: 44100, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
        mocks.addTrack.mockReturnValue({ id: 'track-fresh', name: 'Rendered', kind: 'audio' });
        mocks.addClip.mockReturnValue({ id: 'clip-fresh', trackId: 'track-fresh' });

        const result = renderToClip({
            targetTrackId: 'new',
            startBeat: 0,
            endBeat: 8,
            tailSeconds: 0,
            buffer,
            name: 'Rendered',
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Rendered', kind: 'audio' });
        expect(result?.trackId).toBe('track-fresh');
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 'track-fresh', startBeat: 0, endBeat: 8 })
        );
    });

    describe('a render that carried a tail', () => {
        it('spans the buffer at a tempo other than 120', () => {
            setFlatTempo(133);

            // Beats 0-8 are 3.609 s at 133 BPM. Six seconds of audio holds the
            // decay past them and ends at 6 s * 133 / 60 = 13.3 beats.
            const ends = placeRender({
                startBeat: 0,
                endBeat: 8,
                tailSeconds: 2.391,
                buffer: createRenderedBuffer(6 * SAMPLE_RATE),
            });

            expect(ends.first).toBeCloseTo(13.3, 5);
            expect(ends.redo).toBeCloseTo(13.3, 5);
        });

        it('spans the buffer from a start after beat zero at a tempo other than 120', () => {
            setFlatTempo(133);

            // The buffer begins where beat 16 sounds and holds 6 s, which at
            // 133 BPM is 6 * 133 / 60 = 13.3 beats: it ends at beat 29.3. Beat 16
            // sits at a fractional sample, so the placement rounds it to the nearest
            // one; that moves the end by under a thousandth of a beat.
            const ends = placeRender({
                startBeat: 16,
                endBeat: 24,
                tailSeconds: 2,
                buffer: createRenderedBuffer(6 * SAMPLE_RATE),
            });

            expect(ends.first).toBeCloseTo(29.3, 4);
            expect(ends.redo).toBeCloseTo(29.3, 4);
        });

        it('spans the buffer across a tempo change from a start after beat zero', () => {
            setTempoMap([
                { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-b', beat: 8, tempo: 60, curve: 'instant' },
            ]);

            // Beat 4 sits at 2 s. Eight seconds of audio reaches 10 s: beat 8 is at
            // 4 s, and the six seconds after it run at 60 BPM, six beats further.
            const ends = placeRender({
                startBeat: 4,
                endBeat: 12,
                tailSeconds: 2,
                buffer: createRenderedBuffer(8 * SAMPLE_RATE),
            });

            expect(ends.first).toBeCloseTo(14, 5);
            expect(ends.redo).toBeCloseTo(14, 5);
        });

        it('spans the buffer at the 120 BPM fallback when no tempo is set', () => {
            // Beats 16-24 are 4 s starting at second 8. Six seconds of audio
            // keeps two seconds of decay, which lands at beat 28.
            const ends = placeRender({
                startBeat: 16,
                endBeat: 24,
                tailSeconds: 2,
                buffer: createRenderedBuffer(6 * SAMPLE_RATE),
            });

            expect(ends.first).toBeCloseTo(28, 5);
            expect(ends.redo).toBeCloseTo(28, 5);
        });
    });

    describe('a render that carried no tail', () => {
        it('keeps the exact musical end although the buffer length is rounded up to a whole sample', () => {
            setFlatTempo(133);

            const seconds = (16 * 60) / 133;
            const length = Math.ceil(seconds * SAMPLE_RATE);
            // The premise: the rounded-up buffer reads back past beat 16, which is
            // what moved duplicates placed at the clip's end off the grid.
            expect(length / SAMPLE_RATE).toBeGreaterThan(seconds);

            const ends = placeRender({
                startBeat: 0,
                endBeat: 16,
                tailSeconds: 0,
                buffer: createRenderedBuffer(length),
            });

            expect(ends.first).toBe(16);
            expect(ends.redo).toBe(16);
        });
    });

    it('re-adds the clip with the same start beat as the first add when redo is run with a non-zero startBeat', () => {
        const input: Omit<RenderToClipInput, 'targetTrackId' | 'name'> = {
            startBeat: 8,
            endBeat: 16,
            tailSeconds: 0,
            buffer: createRenderedBuffer(SAMPLE_RATE * 4.8),
        };
        mocks.addClip.mockReturnValue({ id: 'clip-placed', trackId: 'track-1' });
        renderToClip({ ...input, targetTrackId: 'track-1', name: 'Rendered' });

        // First add should have the input startBeat and endBeat values.
        const firstAdd = mocks.addClip.mock.calls[0]?.[0];
        expect(firstAdd).toBeDefined();
        expect(firstAdd).toMatchObject({ startBeat: 8, endBeat: 16 });

        const recordedUndo = mocks.pushUndoEntry.mock.calls[0];
        if (!recordedUndo) {
            throw new Error('expected a render-to-clip undo entry');
        }
        const redo: () => void = recordedUndo[2];
        mocks.addClip.mockClear();
        mocks.addClip.mockReturnValue({ id: 'clip-placed', trackId: 'track-1' });
        redo();

        // Redo should add the clip with the same arguments as the first add.
        expect(mocks.addClip).toHaveBeenNthCalledWith(1, firstAdd);
    });
});

function resetTempo(): void {
    tempoMapStore.set({ changes: [] });
    transportStore.set(defaultTransportState);
}

function setFlatTempo(tempo: number): void {
    transportStore.set({ ...defaultTransportState, tempo });
    tempoMapStore.set({ changes: [] });
}

function setTempoMap(changes: TempoMapStoreState['changes']): void {
    tempoMapStore.set({ changes });
}

/** Renders to a clip, then runs the redo, and returns the end beat each add received. */
function placeRender(input: Omit<RenderToClipInput, 'targetTrackId' | 'name'>): PlacedEnds {
    mocks.addClip.mockReturnValue({ id: 'clip-placed', trackId: 'track-1' });
    renderToClip({ ...input, targetTrackId: 'track-1', name: 'Rendered' });

    const first = lastAddedEndBeat();
    const recordedUndo = mocks.pushUndoEntry.mock.calls[0];
    if (!recordedUndo) {
        throw new Error('expected a render-to-clip undo entry');
    }
    const redo: () => void = recordedUndo[2];
    mocks.addClip.mockClear();
    mocks.addClip.mockReturnValue({ id: 'clip-placed', trackId: 'track-1' });
    redo();

    return { first, redo: lastAddedEndBeat() };
}

function lastAddedEndBeat(): number {
    const call = mocks.addClip.mock.calls.at(-1);
    const added: { endBeat?: number } | undefined = call?.[0];
    if (added?.endBeat === undefined) {
        throw new Error('expected addClip to receive an end beat');
    }
    return added.endBeat;
}

function createRenderedBuffer(lengthSamples: number): AudioBuffer {
    const channel = new Float32Array(lengthSamples);
    return {
        duration: lengthSamples / SAMPLE_RATE,
        length: lengthSamples,
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        getChannelData: () => channel,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    };
}
