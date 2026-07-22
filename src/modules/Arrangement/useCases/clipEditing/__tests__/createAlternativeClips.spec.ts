import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    updateTrack: vi.fn<(typeof updateTrackRepo)['updateTrack']>(),
    setNotesForClip: vi.fn<(clipId: string, notes: WrittenNote[]) => void>(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));
vi.mock('#/modules/MIDI/useCases', () => ({ setNotesForClip: mocks.setNotesForClip }));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../../models/Track';
import { createAlternativeClips, type VariationNote } from '../createAlternativeClips';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as updateTrackRepo from '../../../repositories/track/updateTrack';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';

const note = (overrides?: Partial<VariationNote>): VariationNote => ({
    pitch: 60,
    startBeat: 0,
    duration: 1,
    velocity: 100,
    ...overrides,
});

function setState(clips: Clip[]): Track {
    const track = TrackDummy.create({ id: 't1', clips });
    mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 't1' });
    return track;
}

/** Apply the captured updateTrack updater to the given track and return the result. */
function applyTrackUpdate(track: Track): Track {
    const updater = mocks.updateTrack.mock.calls[0]?.[1];
    if (!updater) {
        throw new Error('expected updateTrack to receive an updater');
    }
    return updater(track);
}

type WrittenNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability: number;
};

function writtenNotes(callIndex: number): { clipId: string; notes: WrittenNote[] } {
    const call = mocks.setNotesForClip.mock.calls[callIndex];
    if (!call) {
        throw new Error(`expected setNotesForClip call #${String(callIndex)}`);
    }
    return { clipId: call[0], notes: call[1] };
}

describe('createAlternativeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'c1' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns false when track state is unavailable', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(createAlternativeClips('c1', [[note()]])).toBe(false);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('returns false when the original clip is not found', () => {
        setState([]);
        expect(createAlternativeClips('missing', [[note()]])).toBe(false);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('rejects an ineligible owner before allocating ids or writing MIDI', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(createAlternativeClips('c1', [[note()]])).toBe(false);

        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        randomUuid.mockRestore();
    });

    it('rejects an empty variation set without allocating or publishing', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(createAlternativeClips('c1', [])).toBe(false);

        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        randomUuid.mockRestore();
    });

    it('rejects a malformed later variation before allocating or writing any earlier variation', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);
        const variations = [[note()], [note({ pitch: 64 })]];
        Object.defineProperty(variations[1], 0, { value: null });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(createAlternativeClips('c1', variations)).toBe(false);

        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('appends muted variation clips back-to-back after the original clip', () => {
        const original = ClipDummy.create({ id: 'c1', name: 'Lead', startBeat: 4, endBeat: 8, type: 'midi' });
        const track = setState([original]);

        expect(createAlternativeClips('c1', [[note()], [note({ pitch: 64 })]])).toBe(true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updated = applyTrackUpdate(track);
        expect(updated.clips).toHaveLength(3);

        const [kept, var1, var2] = updated.clips;
        expect(kept).toBe(original);
        expect(var1).toMatchObject({ name: 'Lead (Var 1)', startBeat: 8, endBeat: 12, muted: true });
        expect(var2).toMatchObject({ name: 'Lead (Var 2)', startBeat: 12, endBeat: 16, muted: true });
        expect(var1?.id).toMatch(/^clip-var-/);
        expect(var2?.id).toMatch(/^clip-var-/);
        expect(var1?.id).not.toBe(var2?.id);
    });

    it('writes variation notes shifted to each variation clip start', () => {
        setState([ClipDummy.create({ id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' })]);

        createAlternativeClips('c1', [[note({ startBeat: 1.5 })], [note({ startBeat: 0.25 })]]);

        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(2);
        const first = writtenNotes(0);
        const second = writtenNotes(1);

        expect(first.clipId).toMatch(/^clip-var-/);
        expect(first.notes[0]).toMatchObject({
            pitch: 60,
            startBeat: 5.5,
            duration: 1,
            velocity: 100,
            probability: 100,
        });
        expect(first.notes[0]?.id).toMatch(/^note-/);
        // Second variation clip starts at beat 8 (two clip lengths after 0..4).
        expect(second.notes[0]?.startBeat).toBe(8.25);
    });

    it('clamps out-of-range values and guards against non-finite LLM output', () => {
        setState([ClipDummy.create({ id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' })]);

        createAlternativeClips('c1', [
            [
                note({ pitch: 200, velocity: 0, duration: -1, startBeat: -3 }),
                note({ pitch: Number.NaN, velocity: Number.POSITIVE_INFINITY, duration: Number.NaN }),
            ],
        ]);

        const { notes } = writtenNotes(0);
        expect(notes[0]).toMatchObject({ pitch: 127, velocity: 1, duration: 0.0625, startBeat: 4 });
        expect(notes[1]).toMatchObject({ pitch: 60, velocity: 80, duration: 0.5 });
    });
});
