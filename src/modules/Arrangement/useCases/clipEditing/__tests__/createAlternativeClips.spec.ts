import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    updateTrack: vi.fn<(typeof updateTrackRepo)['updateTrack']>(),
    setNotesForClip: vi.fn<(clipId: string, notes: WrittenNote[]) => void>(),
    getNextClipId: vi.fn<() => string>(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
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

function setState(clips: Clip[], additionalTracks: Track[] = []): Track {
    const track = TrackDummy.create({ id: 't1', clips });
    mocks.getTrackState.mockReturnValue({ tracks: [track, ...additionalTracks], selectedTrackId: 't1' });
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
        let nextClipId = 0;
        mocks.getNextClipId.mockImplementation(() => `clip-canonical-${String(++nextClipId)}`);
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

    it.each([
        ['non-finite start', Number.NaN, 4],
        ['non-finite end', 0, Number.POSITIVE_INFINITY],
        ['zero duration', 4, 4],
        ['negative duration', 8, 4],
    ])('rejects %s source geometry before allocation or effects', (_label, startBeat, endBeat) => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi', startBeat, endBeat })]);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(createAlternativeClips('c1', [[note()]])).toBe(false);

        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it.each(['active clips', 'saved alternatives'] as const)(
        'rejects canonical clip ids occupied by project-wide %s before effects',
        (location) => {
            const occupiedClip = ClipDummy.create({ id: 'clip-occupied', trackId: 't2' });
            const otherTrack = TrackDummy.create({
                id: 't2',
                clips: location === 'active clips' ? [occupiedClip] : [],
                alternatives:
                    location === 'saved alternatives'
                        ? [{ id: 'other-alt', name: 'Other', clips: [occupiedClip] }]
                        : [{ id: 'other-alt', name: 'Other', clips: [] }],
                activeAlternativeId: 'other-alt',
            });
            setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })], [otherTrack]);
            mocks.getNextClipId.mockReturnValue('clip-occupied');

            expect(createAlternativeClips('c1', [[note()]])).toBe(false);

            expect(mocks.setNotesForClip).not.toHaveBeenCalled();
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        }
    );

    it('preallocates the complete batch before rejecting a later project collision', () => {
        const occupiedClip = ClipDummy.create({ id: 'clip-occupied', trackId: 't2' });
        const otherTrack = TrackDummy.create({ id: 't2', clips: [occupiedClip] });
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })], [otherTrack]);
        mocks.getNextClipId.mockReturnValueOnce('clip-new').mockReturnValueOnce('clip-occupied');

        expect(createAlternativeClips('c1', [[note()], [note()]])).toBe(false);

        expect(mocks.getNextClipId).toHaveBeenCalledTimes(2);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects duplicate canonical clip ids within the staged batch', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);
        mocks.getNextClipId.mockReturnValue('clip-duplicate');

        expect(createAlternativeClips('c1', [[note()], [note()]])).toBe(false);

        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects duplicate note ids across the staged batch before effects', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');

        expect(createAlternativeClips('c1', [[note()], [note()]])).toBe(false);

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
        expect(var1?.id).toBe('clip-canonical-1');
        expect(var2?.id).toBe('clip-canonical-2');
        expect(var1?.id).not.toBe(var2?.id);
        expect(mocks.getNextClipId).toHaveBeenCalledTimes(2);
    });

    it('writes variation notes shifted to each variation clip start', () => {
        setState([ClipDummy.create({ id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' })]);

        createAlternativeClips('c1', [[note({ startBeat: 1.5 })], [note({ startBeat: 0.25 })]]);

        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(2);
        const first = writtenNotes(0);
        const second = writtenNotes(1);

        expect(first.clipId).toBe('clip-canonical-1');
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

    it.each([
        ['null', null],
        ['non-object primitive', 'not-a-note'],
    ])('rejects a %s variation note without allocating or writing', (_label, badNote) => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        // A single bad note invalidates the whole variation set.
        expect(createAlternativeClips('c1', [[badNote as unknown as VariationNote]])).toBe(false);

        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it.each([
        ['pitch', { pitch: 'sixty', startBeat: 0, duration: 1, velocity: 80 }],
        ['startBeat', { pitch: 60, startBeat: 'zero', duration: 1, velocity: 80 }],
        ['duration', { pitch: 60, startBeat: 0, duration: 'one', velocity: 80 }],
        ['velocity', { pitch: 60, startBeat: 0, duration: 1, velocity: 'loud' }],
    ])('rejects a variation note with a non-number %s field', (_label, badNote) => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);

        expect(createAlternativeClips('c1', [[badNote as unknown as VariationNote]])).toBe(false);

        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects a variation set that is not an array of arrays', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);

        expect(createAlternativeClips('c1', 'not-variations' as unknown as VariationNote[][])).toBe(false);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects a variation whose element is not an array', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' })]);

        expect(createAlternativeClips('c1', [[note()], 'not-an-array' as unknown as VariationNote[]])).toBe(false);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('treats a variation array of only empty note-arrays as a valid (silent) variation', () => {
        setState([ClipDummy.create({ id: 'c1', name: 'Lead', startBeat: 0, endBeat: 4, type: 'midi' })]);

        expect(createAlternativeClips('c1', [[]])).toBe(true);
        // No notes to write for the silent variation, but the clip row is still appended.
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('clip-canonical-1', []);
    });

    it('preserves the original clip identity and overrides only name/position/mute/id', () => {
        const original = ClipDummy.create({
            id: 'c1',
            trackId: 't1',
            name: 'Lead',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
            gain: 0.9,
            color: '#abc',
            locked: true,
        });
        const track = setState([original]);

        createAlternativeClips('c1', [[note()]]);

        const updated = applyTrackUpdate(track);
        const variationClip = updated.clips[1];
        expect(variationClip).toMatchObject({
            gain: 0.9,
            color: '#abc',
            locked: true,
            type: 'midi',
            trackId: 't1',
        });
    });
});
