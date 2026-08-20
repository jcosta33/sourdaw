import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { glueClips } from '../glueClips';

import type { prepareMidiClipGlueState as originalPrepareMidiClipGlueState } from '#/modules/MIDI/useCases';
import type { Track } from '../../../models/Track';
import type { TrackState, getTrackState as originalGetTrackState } from '../../../repositories/track/getTrackState';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof originalGetTrackState>(),
    setTrackState: vi.fn<(state: TrackState) => void>(),
    getNextClipId: vi.fn(() => 'merged-clip'),
    prepareMidiClipGlueState: vi.fn<typeof originalPrepareMidiClipGlueState>(),
    restoreMidiClipGlueState: vi.fn(() => true),
    midiClipGlueStateMatches: vi.fn(() => true),
    hasActiveStepRecordingDependency: vi.fn(() => false),
    getAutomationLanes: vi.fn(() => []),
    warn: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('#/modules/MIDI/useCases', () => ({
    hasActiveStepRecordingDependency: mocks.hasActiveStepRecordingDependency,
    prepareMidiClipGlueState: mocks.prepareMidiClipGlueState,
    restoreMidiClipGlueState: mocks.restoreMidiClipGlueState,
    midiClipGlueStateMatches: mocks.midiClipGlueStateMatches,
}));
vi.mock('#/modules/Automation/useCases', () => ({ getAutomationLanes: mocks.getAutomationLanes }));
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
        const absentData = {
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        };
        mocks.prepareMidiClipGlueState.mockReturnValue({
            previous: {
                clips: [
                    { clipId: 'a', data: absentData },
                    { clipId: 'b', data: absentData },
                    { clipId: 'merged-clip', data: absentData },
                ],
                migratedAbsoluteNoteClipIds: { present: false, value: [] },
            },
            next: {
                clips: [
                    { clipId: 'a', data: absentData },
                    { clipId: 'b', data: absentData },
                    { clipId: 'merged-clip', data: absentData },
                ],
                migratedAbsoluteNoteClipIds: { present: true, value: ['merged-clip'] },
            },
        });
        mocks.restoreMidiClipGlueState.mockReturnValue(true);
    });

    it('refuses to glue audio clips instead of producing a silent clip (regression: ledger M-027)', () => {
        const audioA = ClipDummy.create({ id: 'a', trackId: 't1', type: 'audio', startBeat: 0, endBeat: 4 });
        const audioB = ClipDummy.create({ id: 'b', trackId: 't1', type: 'audio', startBeat: 4, endBeat: 8 });
        mocks.getTrackState.mockReturnValue(
            createTrackState([TrackDummy.create({ id: 't1', clips: [audioA, audioB] })])
        );

        expect(glueClips(['a', 'b'])).toBe(false);

        // Sources must be untouched: no glued clip written, no MIDI gluing,
        // and a warning explaining the refusal.
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledOnce();
    });

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(glueClips(['a', 'b'])).toBe(false);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
    });

    it('does nothing with less than 2 clips', () => {
        mocks.getTrackState.mockReturnValue(createTrackState([]));
        expect(glueClips(['a'])).toBe(false);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
    });

    it('does nothing with empty clip list', () => {
        mocks.getTrackState.mockReturnValue(createTrackState([]));
        expect(glueClips([])).toBe(false);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
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

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
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
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
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

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
    });

    it('does nothing when fewer than two selected clips are on the matching track', () => {
        const track = TrackDummy.create({
            id: 't1',
            clips: [ClipDummy.create({ id: 'a', trackId: 't1' })],
        });
        mocks.getTrackState.mockReturnValue(createTrackState([track]));

        glueClips(['a', 'missing']);

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
    });

    it('keeps source clips when MIDI state cannot be prepared', () => {
        const firstClip = ClipDummy.create({ id: 'a', trackId: 't1', type: 'midi', startBeat: 0, endBeat: 4 });
        const secondClip = ClipDummy.create({ id: 'b', trackId: 't1', type: 'midi', startBeat: 4, endBeat: 8 });
        mocks.getTrackState.mockReturnValue(
            createTrackState([TrackDummy.create({ id: 't1', kind: 'midi', clips: [firstClip, secondClip] })])
        );
        mocks.prepareMidiClipGlueState.mockReturnValue(null);

        expect(glueClips(['a', 'b'])).toBe(false);

        expect(mocks.prepareMidiClipGlueState).toHaveBeenCalledOnce();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('rejects looped MIDI clips until loop materialization is supported', () => {
        const firstClip = ClipDummy.create({ id: 'a', trackId: 't1', type: 'midi', startBeat: 0, endBeat: 4 });
        const loopedClip = ClipDummy.create({
            id: 'b',
            trackId: 't1',
            type: 'midi',
            startBeat: 4,
            endBeat: 12,
            loopEnabled: true,
            loopLength: 4,
        });
        mocks.getTrackState.mockReturnValue(
            createTrackState([TrackDummy.create({ id: 't1', kind: 'midi', clips: [firstClip, loopedClip] })])
        );

        expect(glueClips(['a', 'b'])).toBe(false);

        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledWith('glueClips: looped MIDI clips must be flattened before gluing');
    });

    it.each([
        ['locked', { locked: true }],
        ['muted', { muted: true }],
        ['gain-adjusted', { gain: 0.5 }],
        ['stretched', { stretchMode: 'timestretch' as const, stretchRatio: 2 }],
        ['linked', { parentClipId: 'source', isLinkedInstance: true }],
        ['scale-folded', { sourceKeyRoot: 2, sourceScaleName: 'Dorian' }],
    ])('rejects %s source clips instead of discarding their semantics', (_label, modifier) => {
        const firstClip = ClipDummy.create({ id: 'a', trackId: 't1', type: 'midi', startBeat: 0, endBeat: 4 });
        const modifiedClip = ClipDummy.create({
            id: 'b',
            trackId: 't1',
            type: 'midi',
            startBeat: 4,
            endBeat: 8,
            ...modifier,
        });
        mocks.getTrackState.mockReturnValue(
            createTrackState([TrackDummy.create({ id: 't1', kind: 'midi', clips: [firstClip, modifiedClip] })])
        );

        expect(glueClips(['a', 'b'])).toBe(false);

        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it.each([
        ['gap', 5],
        ['overlap', 3],
    ])('rejects clips separated by a %s', (_label, secondStartBeat) => {
        const firstClip = ClipDummy.create({ id: 'a', trackId: 't1', type: 'midi', startBeat: 0, endBeat: 4 });
        const secondClip = ClipDummy.create({
            id: 'b',
            trackId: 't1',
            type: 'midi',
            startBeat: secondStartBeat,
            endBeat: 8,
        });
        mocks.getTrackState.mockReturnValue(
            createTrackState([TrackDummy.create({ id: 't1', kind: 'midi', clips: [firstClip, secondClip] })])
        );

        expect(glueClips(['a', 'b'])).toBe(false);

        expect(mocks.prepareMidiClipGlueState).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('writes MIDI before replacing clips and orders glue metadata by timeline position', () => {
        const firstClip = ClipDummy.create({
            id: 'a',
            trackId: 't1',
            name: 'Clip A',
            startBeat: 4,
            endBeat: 8,
            type: 'midi',
            fadeInBeats: 0.25,
            fadeOutBeats: 0.5,
            color: 'cyan',
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
        const track = TrackDummy.create({ id: 't1', kind: 'midi', clips: [firstClip, secondClip] });
        const selectedClipIds = ['a', 'b'];
        mocks.getTrackState.mockReturnValue(createTrackState([track]));

        expect(glueClips(selectedClipIds)).toBe(true);

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        expect(mocks.prepareMidiClipGlueState).toHaveBeenCalledTimes(1);
        expect(mocks.restoreMidiClipGlueState).toHaveBeenCalledTimes(1);
        const setCall = mocks.setTrackState.mock.calls[0];
        const midiCall = mocks.prepareMidiClipGlueState.mock.calls[0];
        const setInvocationOrder = mocks.setTrackState.mock.invocationCallOrder[0];
        const midiInvocationOrder = mocks.restoreMidiClipGlueState.mock.invocationCallOrder[0];
        if (!setCall || !midiCall || setInvocationOrder === undefined || midiInvocationOrder === undefined) {
            throw new Error('Expected Arrangement and MIDI glue calls');
        }

        const [nextState] = setCall;
        const [midiInput] = midiCall;
        expect(midiInput).toEqual({
            sources: [
                { clipId: 'b', beatOffset: 0, visibleStartBeat: 0, visibleEndBeat: 4 },
                { clipId: 'a', beatOffset: 4, visibleStartBeat: 0, visibleEndBeat: 4 },
            ],
            targetClipId: 'merged-clip',
        });
        expect(midiInvocationOrder).toBeLessThan(setInvocationOrder);
        expect(nextState.tracks[0]).toEqual({
            ...track,
            clips: [
                {
                    id: 'merged-clip',
                    trackId: 't1',
                    name: 'Clip B (glued)',
                    startBeat: 0,
                    endBeat: 8,
                    type: 'midi',
                    fadeInBeats: 0.75,
                    fadeOutBeats: 0.5,
                    gain: 1,
                    color: 'magenta',
                    locked: false,
                    muted: false,
                },
            ],
        });
    });
});
