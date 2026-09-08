import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    setTrackState: vi.fn<(typeof trackSetRepo)['setTrackState']>(),
    getNextClipId: vi.fn(() => 'new-clip-right'),
    snapToZeroCrossing: vi.fn<(typeof snapModule)['snapToZeroCrossing']>(),
    prepareMidiClipSplit: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/modules/MIDI/useCases', () => ({
    prepareMidiClipSplit: mocks.prepareMidiClipSplit,
    splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat,
}));
vi.mock('../../timelineInteractions/snapToZeroCrossing', () => ({ snapToZeroCrossing: mocks.snapToZeroCrossing }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

import { getAutomationLanes, getAutomationValueAtBeat, restoreAutomationSnapshot } from '#/modules/Automation/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { type TrackState } from '../../../repositories/track/getTrackState';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { splitClip } from '../splitClip';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as trackSetRepo from '../../../repositories/track/setTrackState';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';
import type * as snapModule from '../../timelineInteractions/snapToZeroCrossing';

function makeClip(id: string, start: number, end: number, type: Clip['type'] = 'audio'): Clip {
    return ClipDummy.create({ id, name: id, startBeat: start, endBeat: end, type, fadeInBeats: 0, fadeOutBeats: 0 });
}

function makeState(clips: Clip[]): TrackState {
    return { tracks: [TrackDummy.create({ id: 't1', clips })], selectedTrackId: 't1' };
}

function newTrackState(): TrackState {
    const newState = mocks.setTrackState.mock.calls[0]?.[0];
    if (!newState) {
        throw new Error('expected setTrackState to be called with the split state');
    }
    return newState;
}

describe('splitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        warpStates.clear();
        __resetGainEnvelopesForTest();
        mocks.getNextClipId.mockReturnValue('new-clip-right');
        mocks.snapToZeroCrossing.mockImplementation((_clip, beat) => beat);
        mocks.prepareMidiClipSplit.mockImplementation(() => {
            const emptyMidi = {
                notes: { present: false, value: [] },
                controlChanges: { present: false, value: [] },
                pitchBends: { present: false, value: [] },
            };
            return {
                targetNoteIds: [],
                previousSource: emptyMidi,
                previousRight: emptyMidi,
                nextSource: emptyMidi,
                nextRight: emptyMidi,
            };
        });
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'c1' });
    });

    it('returns null when no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(splitClip('c1', 2)).toBeNull();
    });

    it('returns null when clip not found', () => {
        mocks.getTrackState.mockReturnValue(makeState([]));
        expect(splitClip('nonexistent', 2)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('rejects an ineligible owner before snapping, allocating, or writing', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        expect(splitClip('c1', 2)).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects a non-finite split beat before snapping or allocating', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        expect(splitClip('c1', Number.NaN)).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('uses a preflight-resolved audio beat without resnapping against changed transport state', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 8)]));

        expect(splitClip('c1', 4, 'right-clip', [], 4.125)).toBe('right-clip');

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(newTrackState().tracks[0]!.clips).toMatchObject([
            { id: 'c1', endBeat: 4.125 },
            { id: 'right-clip', startBeat: 4.125 },
        ]);
    });

    it('rejects an empty explicit destination id before snapping or writing', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 2, '')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects the source id as an explicit destination before snapping or writing', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 2, 'c1')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects an explicit destination id already used on another track', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                TrackDummy.create({ id: 't1', clips: [makeClip('c1', 0, 4, 'midi')] }),
                TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'occupied', trackId: 't2' })] }),
            ],
            selectedTrackId: 't1',
        });

        expect(splitClip('c1', 2, 'occupied')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects an explicit destination id stored in an inactive alternative', () => {
        const track = TrackDummy.create({
            id: 't1',
            activeAlternativeId: 'active',
            clips: [makeClip('c1', 0, 4, 'midi')],
            alternatives: [
                { id: 'active', name: 'Active', clips: [] },
                {
                    id: 'inactive',
                    name: 'Inactive',
                    clips: [ClipDummy.create({ id: 'captured-right', trackId: 't1', type: 'midi' })],
                },
            ],
        });
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 't1' });

        expect(splitClip('c1', 2, 'captured-right')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('reuses a free explicit destination id without allocating another id', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 2, 'captured-right')).toBe('captured-right');

        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith({
            sourceClipId: 'c1',
            newClipId: 'captured-right',
            splitBeat: 2,
            targetNoteIds: [],
        });
    });

    it('returns null when split at clip start', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        expect(splitClip('c1', 0)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns null when split at clip end', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        expect(splitClip('c1', 4)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('splits clip at midpoint into a trimmed left clip and an offset right clip', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        const result = splitClip('c1', 2);
        expect(result).toBe('new-clip-right');
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);

        const clips = newTrackState().tracks[0]?.clips ?? [];
        expect(clips).toHaveLength(2);
        const left = clips.find((context) => context.name.includes('(L)'));
        const right = clips.find((context) => context.name.includes('(R)'));
        expect(left).toMatchObject({ id: 'c1', startBeat: 0, endBeat: 2, fadeOutBeats: 0 });
        expect(right).toMatchObject({
            id: 'new-clip-right',
            startBeat: 2,
            endBeat: 4,
            fadeInBeats: 0,
            audioOffsetBeats: 2,
        });
    });

    it('uses snapToZeroCrossing to adjust the split point of audio clips', () => {
        mocks.snapToZeroCrossing.mockReturnValue(2.5);
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'audio')]));

        splitClip('c1', 2);
        expect(mocks.snapToZeroCrossing).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 2);

        const clips = newTrackState().tracks[0]?.clips ?? [];
        expect(clips.find((context) => context.id === 'c1')?.endBeat).toBe(2.5);
        expect(clips.find((context) => context.id === 'new-clip-right')?.startBeat).toBe(2.5);
    });

    it('does not call splitMidiNotesAtBeat for audio clips', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'audio')]));

        splitClip('c1', 2);
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('partitions midi notes across both clip ids for midi clips', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 3)).toBe('new-clip-right');
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith({
            sourceClipId: 'c1',
            newClipId: 'new-clip-right',
            splitBeat: 3,
            targetNoteIds: [],
        });
    });

    it('returns null when snap pushes split outside clip', () => {
        mocks.snapToZeroCrossing.mockReturnValue(0);
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        expect(splitClip('c1', 2)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('leaves unrelated tracks untouched while splitting the owner track', () => {
        const otherClip = makeClip('other', 10, 14);
        mocks.getTrackState.mockReturnValue({
            tracks: [
                TrackDummy.create({ id: 't1', clips: [makeClip('c1', 0, 4)] }),
                TrackDummy.create({ id: 't2', clips: [otherClip] }),
            ],
            selectedTrackId: 't1',
        });

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        const tracks = newTrackState().tracks;
        // The non-owner track is returned verbatim (same clip list, no split).
        const untouched = tracks.find((track) => track.id === 't2');
        expect(untouched?.clips).toEqual([otherClip]);
        expect(untouched?.clips).toHaveLength(1);
    });

    // ── Satellite repartition (M-7) ─────────────────────────────────────────
    //
    // Warp markers are keyed to *source content* beats (the Elastic editor draws
    // them over the whole buffer), so the right half keeps their coordinates —
    // its audioOffsetBeats already re-enters the same buffer. Gain envelope
    // points are clip-relative, so the right half's copy is re-based by the
    // split delta, and each half gets a seam point holding the curve's value at
    // the cut so the audible envelope is unchanged by the split. Neither half
    // drops the points on the far side of the cut: they are inert there, and
    // dropping them would destroy authored curve data.

    it('repartitions warp markers and gain envelope points across both halves of an audio split', () => {
        // Clip 0..8 with audioOffsetBeats 2 → content seam at 4 + 2 = 6.
        mocks.getTrackState.mockReturnValue(
            makeState([ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 8, audioOffsetBeats: 2 })])
        );
        setWarpState('c1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-left', originalBeat: 3, warpedBeat: 3.25 },
                { id: 'w-seam', originalBeat: 6, warpedBeat: 6 },
                { id: 'w-right', originalBeat: 7, warpedBeat: 7.5 },
            ],
        });
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'p6', beatOffset: 6, gainDb: -12 },
            ],
        });

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        // Left keeps only the markers below the content seam, coordinates untouched.
        expect(warpStates.get('c1')?.markers).toEqual([{ id: 'w-left', originalBeat: 3, warpedBeat: 3.25 }]);
        // Right inherits the warp setup and the seam-and-beyond markers, still in
        // content beats — the right clip's audioOffsetBeats grew by the split.
        expect(warpStates.get('new-clip-right')).toEqual({
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-seam', originalBeat: 6, warpedBeat: 6 },
                { id: 'w-right', originalBeat: 7, warpedBeat: 7.5 },
            ],
        });

        // The seam value at clip-relative beat 4 between (0, 0 dB) and (6, -12 dB)
        // is -8 dB; both halves carry it at their cut edge so the curve is intact,
        // and both keep the far-side point so neither loses authored data.
        expect(getEnvelope('c1')).toEqual({
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'gep-split-new-clip-right-left', beatOffset: 4, gainDb: -8 },
                { id: 'p6', beatOffset: 6, gainDb: -12 },
            ],
        });
        expect(getEnvelope('new-clip-right')).toEqual({
            clipId: 'new-clip-right',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: -4, gainDb: 0 },
                { id: 'gep-split-new-clip-right-right', beatOffset: 0, gainDb: -8 },
                { id: 'p6', beatOffset: 2, gainDb: -12 },
            ],
        });
    });

    it('keeps a disabled envelope’s stored points on both halves without enabling it', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: false,
            points: [{ id: 'p2', beatOffset: 2, gainDb: -6 }],
        });

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        expect(getEnvelope('c1')?.enabled).toBe(false);
        expect(getEnvelope('new-clip-right')?.enabled).toBe(false);
        // The point sits exactly at the cut: it already pins the seam value on
        // both halves, so no synthetic seam point is added beside it.
        expect(getEnvelope('c1')?.points).toEqual([{ id: 'p2', beatOffset: 2, gainDb: -6 }]);
        expect(getEnvelope('new-clip-right')?.points).toEqual([{ id: 'p2', beatOffset: 0, gainDb: -6 }]);
    });

    it('writes no satellite state when the split source clip carries none', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        expect(warpStates.size).toBe(0);
        expect(getEnvelope('c1')).toBeUndefined();
        expect(getEnvelope('new-clip-right')).toBeUndefined();
    });

    it('scales audioOffsetBeats and warp marker partition by stretchRatio when splitting a stretched clip', () => {
        mocks.getTrackState.mockReturnValue(
            makeState([
                ClipDummy.create({
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 8,
                    audioOffsetBeats: 2,
                    stretchMode: 'timestretch',
                    stretchRatio: 0.5,
                }),
            ])
        );
        setWarpState('c1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-left', originalBeat: 3, warpedBeat: 3.25 },
                { id: 'w-seam', originalBeat: 4, warpedBeat: 4 },
                { id: 'w-right', originalBeat: 5, warpedBeat: 5.5 },
            ],
        });

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        const clips = newTrackState().tracks[0]?.clips ?? [];
        const right = clips.find((candidate) => candidate.id === 'new-clip-right');
        expect(right?.audioOffsetBeats).toBe(4);

        expect(warpStates.get('c1')?.markers).toEqual([{ id: 'w-left', originalBeat: 3, warpedBeat: 3.25 }]);
        expect(warpStates.get('new-clip-right')?.markers).toEqual([
            { id: 'w-seam', originalBeat: 4, warpedBeat: 4 },
            { id: 'w-right', originalBeat: 5, warpedBeat: 5.5 },
        ]);
    });

    it('scales audioOffsetBeats by stretchRatio when splitting a sped-up clip', () => {
        mocks.getTrackState.mockReturnValue(
            makeState([
                ClipDummy.create({
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 4,
                    audioOffsetBeats: 1,
                    stretchMode: 'timestretch',
                    stretchRatio: 2,
                }),
            ])
        );

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        const clips = newTrackState().tracks[0]?.clips ?? [];
        const right = clips.find((candidate) => candidate.id === 'new-clip-right');
        expect(right?.audioOffsetBeats).toBe(5);
    });

    it('advances a mode-off clip by the plain timeline delta, ignoring its dormant ratio', () => {
        // The runtimes consume 1x unless stretch is on: a mode-off clip holding
        // ratio 2 must split as if unstretched, or the fragment plays twice
        // the consumed content.
        mocks.getTrackState.mockReturnValue(
            makeState([
                ClipDummy.create({
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 8,
                    stretchMode: 'off',
                    stretchRatio: 2,
                }),
            ])
        );

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        const right = newTrackState().tracks[0]?.clips.find((candidate) => candidate.id === 'new-clip-right');
        expect(right?.audioOffsetBeats).toBe(4);
    });

    it('bounds an out-of-range ratio instead of producing an infinite offset', () => {
        // A hydrate-admissible finite ratio is not guaranteed in range; the
        // schedulable bound (100) caps the consumed conversion.
        mocks.getTrackState.mockReturnValue(
            makeState([
                ClipDummy.create({
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 8,
                    stretchMode: 'timestretch',
                    stretchRatio: 1e308,
                }),
            ])
        );

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        const right = newTrackState().tracks[0]?.clips.find((candidate) => candidate.id === 'new-clip-right');
        expect(right?.audioOffsetBeats).toBe(400);
    });

    it('continues to use 1:1 scaling for audioOffsetBeats when splitting an unstretched clip', () => {
        mocks.getTrackState.mockReturnValue(
            makeState([
                ClipDummy.create({
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 4,
                    audioOffsetBeats: 1,
                }),
            ])
        );

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        let clips = newTrackState().tracks[0]?.clips ?? [];
        let right = clips.find((candidate) => candidate.id === 'new-clip-right');
        expect(right?.audioOffsetBeats).toBe(3);

        mocks.getTrackState.mockReturnValue(
            makeState([
                ClipDummy.create({
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 4,
                    audioOffsetBeats: 1,
                    stretchRatio: 1,
                }),
            ])
        );

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        clips = newTrackState().tracks[0]?.clips ?? [];
        right = clips.find((candidate) => candidate.id === 'new-clip-right');
        expect(right?.audioOffsetBeats).toBe(3);
    });

    it('installs the clamped lane copy with its seam on the right fragment of the split', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 8)]));
        restoreAutomationSnapshot({ lanes: [] });

        // A clip-scoped lane on the source, absolute-timeline points astride the
        // cut at 4, with an object that must stay with the surviving left half.
        restoreAutomationSnapshot({
            lanes: [
                {
                    id: 'lane-source',
                    trackId: 't1',
                    clipId: 'c1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 1, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 6, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        // The curve's value at the cut, per the runtime evaluator — the seam
        // point must carry exactly this so the fragment continues the curve.
        const seamValue = getAutomationValueAtBeat('lane-source', 4);
        expect(seamValue).toBeCloseTo(0.56, 10);

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        const lanes = getAutomationLanes();
        expect(lanes).toHaveLength(2);
        const copy = lanes.find((lane) => lane.id === 'auto-split-new-clip-right-0');
        expect(copy?.clipId).toBe('new-clip-right');
        expect(copy?.points).toEqual([
            { id: 'asp-split-new-clip-right-0', beat: 4, value: seamValue, curve: 'linear', tension: 0 },
            { beat: 6, value: 0.8, curve: 'linear', tension: 0 },
        ]);
        // The source lane keeps its id, its whole point set, and its object.
        const source = lanes.find((lane) => lane.id === 'lane-source');
        expect(source?.clipId).toBe('c1');
        expect(source?.points.map((point) => point.beat)).toEqual([1, 6]);

        // Playback continuity: a beat inside the straddling segment plays the
        // same value before and after the split — the fragment continues the
        // curve through the seam instead of holding the first copied value.
        const valueBeforeSplit = getAutomationValueAtBeat('lane-source', 4.5);
        expect(valueBeforeSplit).toBeCloseTo(0.62, 10);
        expect(getAutomationValueAtBeat('auto-split-new-clip-right-0', 4.5)).toBe(valueBeforeSplit);
    });

    it('carries a linked follower lane onto the fragment with its link intact', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 8)]));
        restoreAutomationSnapshot({ lanes: [] });

        // A self-standing leader and a follower with no own points: the
        // follower's played curve comes entirely from its link target, so the
        // split must judge it by the leader's content, not its own.
        restoreAutomationSnapshot({
            lanes: [
                {
                    id: 'lane-leader',
                    trackId: 't1',
                    clipId: 'c1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 1, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 6, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
                {
                    id: 'lane-follower',
                    trackId: 't1',
                    clipId: 'c1',
                    parameterId: 'pan',
                    parameterName: 'Pan',
                    linkedLaneId: 'lane-leader',
                    linkScale: -1,
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: -1,
                    maxValue: 1,
                },
            ],
        });

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        const lanes = getAutomationLanes();
        const leaderCopy = lanes.find((lane) => lane.id === 'auto-split-new-clip-right-0');
        const followerCopy = lanes.find((lane) => lane.id === 'auto-split-new-clip-right-1');
        // Both copies land on the fragment, and the follower copy follows the
        // leader's copy — the fragment's chain is self-contained.
        expect(leaderCopy?.clipId).toBe('new-clip-right');
        expect(followerCopy?.clipId).toBe('new-clip-right');
        expect(followerCopy?.linkedLaneId).toBe('auto-split-new-clip-right-0');
        expect(followerCopy?.linkScale).toBe(-1);
        // Pan keeps following over the right span: inside the former
        // straddling segment the follower evaluates to the leader copy's
        // value times the link scale, seam included.
        const leaderValue = requiredValue('auto-split-new-clip-right-0', 4.5);
        expect(leaderValue).toBeCloseTo(0.62, 10);
        expect(getAutomationValueAtBeat('auto-split-new-clip-right-1', 4.5)).toBeCloseTo(-leaderValue, 10);
        // The originals survive on the left half and still follow each other.
        expect(lanes.find((lane) => lane.id === 'lane-follower')?.linkedLaneId).toBe('lane-leader');
        expect(getAutomationValueAtBeat('lane-follower', 2)).toBeCloseTo(-requiredValue('lane-leader', 2), 10);
    });

    it('keeps a drawn-then-held lane and its follower driving over the right span', () => {
        // The common shape: ramps ending mid-clip. The runtime holds the last
        // value for every beat after it, so both lanes were still driving over
        // [4, 8) before the split — the fragment must keep that, not step the
        // parameters back to base at the cut.
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 8)]));
        restoreAutomationSnapshot({ lanes: [] });
        restoreAutomationSnapshot({
            lanes: [
                {
                    id: 'lane-held',
                    trackId: 't1',
                    clipId: 'c1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 1, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 3, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
                {
                    id: 'lane-held-follower',
                    trackId: 't1',
                    clipId: 'c1',
                    parameterId: 'pan',
                    parameterName: 'Pan',
                    linkedLaneId: 'lane-held',
                    linkScale: -1,
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: -1,
                    maxValue: 1,
                },
            ],
        });

        const heldBeforeSplit = requiredValue('lane-held', 4.5);
        expect(heldBeforeSplit).toBeCloseTo(0.8, 10);

        expect(splitClip('c1', 4)).toBe('new-clip-right');

        const lanes = getAutomationLanes();
        const heldCopy = lanes.find((lane) => lane.id === 'auto-split-new-clip-right-0');
        const followerCopy = lanes.find((lane) => lane.id === 'auto-split-new-clip-right-1');
        expect(heldCopy?.clipId).toBe('new-clip-right');
        expect(followerCopy?.linkedLaneId).toBe('auto-split-new-clip-right-0');
        // The seam pins the held value at the fragment's first beat, and the
        // follower keeps its inverted drive over the right span.
        expect(heldCopy?.points[0]?.value).toBeCloseTo(heldBeforeSplit, 10);
        expect(requiredValue('auto-split-new-clip-right-0', 4.5)).toBeCloseTo(heldBeforeSplit, 10);
        expect(requiredValue('auto-split-new-clip-right-0', 7)).toBeCloseTo(heldBeforeSplit, 10);
        expect(requiredValue('auto-split-new-clip-right-1', 4.5)).toBeCloseTo(-heldBeforeSplit, 10);
    });
});

/** The runtime evaluator reads `number | null`; these lanes must evaluate. */
function requiredValue(laneId: string, beat: number): number {
    const value = getAutomationValueAtBeat(laneId, beat);
    expect(value).not.toBeNull();
    return value ?? Number.NaN;
}
