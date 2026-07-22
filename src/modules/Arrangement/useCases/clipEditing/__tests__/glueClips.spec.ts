import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { glueClips } from '../glueClips';

import type { TrackState, getTrackState as originalGetTrackState } from '../../../repositories/track/getTrackState';
import type { updateTrack as originalUpdateTrack } from '../../../repositories/track/updateTrack';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';

type GlueMidiClipData = (input: { sourceClipIds: readonly string[]; targetClipId: string }) => void;

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof originalGetTrackState>(),
    updateTrack: vi.fn<typeof originalUpdateTrack>(),
    getNextClipId: vi.fn(() => 'merged-clip'),
    glueMidiClipData: vi.fn<GlueMidiClipData>(),
    warn: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('#/modules/MIDI/useCases', () => ({ glueMidiClipData: mocks.glueMidiClipData }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

function createTrackState(tracks: Track[]): TrackState {
    return { tracks, selectedTrackId: 't1', ghostClips: [] };
}

describe('glueClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'a' });
    });

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(glueClips(['a', 'b'])).toBe(false);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
    });

    it('does nothing with less than 2 clips', () => {
        mocks.getTrackState.mockReturnValue(createTrackState([]));
        expect(glueClips(['a'])).toBe(false);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
    });

    it('does nothing with empty clip list', () => {
        mocks.getTrackState.mockReturnValue(createTrackState([]));
        expect(glueClips([])).toBe(false);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
    });

    it('rejects clips spanning multiple tracks', () => {
        const firstTrack = TrackDummy.create({
            id: 't1',
            clips: [ClipDummy.create({ id: 'a', trackId: 't1' })],
        });
        const secondTrack = TrackDummy.create({
            id: 't2',
            clips: [ClipDummy.create({ id: 'b', trackId: 't2' })],
        });
        mocks.getTrackState.mockReturnValue(createTrackState([firstTrack, secondTrack]));
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input) => ({
            status: 'eligible',
            trackId: input.clipId === 'a' ? 't1' : 't2',
        }));

        expect(glueClips(['a', 'b'])).toBe(false);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledWith(
            'glueClips: clips span multiple tracks — gluing is only supported within a single track'
        );
    });

    it('rejects a mixed eligible and ineligible set before warning, allocation, or writes', () => {
        const firstTrack = TrackDummy.create({
            id: 't1',
            clips: [ClipDummy.create({ id: 'a', trackId: 't1' })],
        });
        const secondTrack = TrackDummy.create({
            id: 't2',
            clips: [ClipDummy.create({ id: 'b', trackId: 't2' })],
        });
        mocks.getTrackState.mockReturnValue(createTrackState([firstTrack, secondTrack]));
        mocks.resolveEligibleClipWriteTarget
            .mockReturnValueOnce({ status: 'eligible', trackId: 't1', clipId: 'a' })
            .mockReturnValueOnce({ status: 'ineligible' });

        expect(glueClips(['a', 'b'])).toBe(false);

        expect(mocks.warn).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
    });

    it('rejects duplicate target ids before owner resolution', () => {
        const track = TrackDummy.create({
            id: 't1',
            clips: [ClipDummy.create({ id: 'a', trackId: 't1' })],
        });
        mocks.getTrackState.mockReturnValue(createTrackState([track]));

        expect(glueClips(['a', 'a'])).toBe(false);

        expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
    });

    it('does nothing when the selection has no matching track', () => {
        const track = TrackDummy.create({
            id: 't1',
            clips: [ClipDummy.create({ id: 'other', trackId: 't1' })],
        });
        mocks.getTrackState.mockReturnValue(createTrackState([track]));

        glueClips(['a', 'b']);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
    });

    it('does nothing when fewer than two selected clips are on the matching track', () => {
        const track = TrackDummy.create({
            id: 't1',
            clips: [ClipDummy.create({ id: 'a', trackId: 't1' })],
        });
        mocks.getTrackState.mockReturnValue(createTrackState([track]));

        glueClips(['a', 'missing']);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.glueMidiClipData).not.toHaveBeenCalled();
    });

    it('updates the glued track before forwarding the exact selected ids to MIDI', () => {
        const firstClip = ClipDummy.create({
            id: 'a',
            trackId: 't1',
            name: 'Clip A',
            startBeat: 4,
            endBeat: 8,
            type: 'midi',
            fadeInBeats: 0.25,
            fadeOutBeats: 0.5,
            gain: 0.4,
            color: 'cyan',
            locked: true,
            muted: true,
        });
        const secondClip = ClipDummy.create({
            id: 'b',
            trackId: 't1',
            name: 'Clip B',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
            fadeInBeats: 0.75,
            fadeOutBeats: 1.25,
            color: 'magenta',
        });
        const track = TrackDummy.create({ id: 't1', clips: [firstClip, secondClip] });
        const selectedClipIds = ['a', 'b'];
        mocks.getTrackState.mockReturnValue(createTrackState([track]));

        expect(glueClips(selectedClipIds)).toBe(true);

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.glueMidiClipData).toHaveBeenCalledTimes(1);
        const updateCall = mocks.updateTrack.mock.calls[0];
        const midiCall = mocks.glueMidiClipData.mock.calls[0];
        const updateInvocationOrder = mocks.updateTrack.mock.invocationCallOrder[0];
        const midiInvocationOrder = mocks.glueMidiClipData.mock.invocationCallOrder[0];
        if (!updateCall || !midiCall || updateInvocationOrder === undefined || midiInvocationOrder === undefined) {
            throw new Error('Expected Arrangement and MIDI glue calls');
        }

        const [trackId, updater] = updateCall;
        const [midiInput] = midiCall;
        expect(trackId).toBe('t1');
        expect(midiInput).toEqual({ sourceClipIds: selectedClipIds, targetClipId: 'merged-clip' });
        expect(midiInput.sourceClipIds).toBe(selectedClipIds);
        expect(updateInvocationOrder).toBeLessThan(midiInvocationOrder);
        expect(updater(track)).toEqual({
            ...track,
            clips: [
                {
                    id: 'merged-clip',
                    trackId: 't1',
                    name: 'Clip A (glued)',
                    startBeat: 0,
                    endBeat: 8,
                    type: 'midi',
                    fadeInBeats: 0.25,
                    fadeOutBeats: 1.25,
                    gain: 1,
                    color: 'cyan',
                    locked: false,
                    muted: false,
                },
            ],
        });
    });
});
