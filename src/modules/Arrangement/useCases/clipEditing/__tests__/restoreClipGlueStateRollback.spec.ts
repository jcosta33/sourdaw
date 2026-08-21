import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { midiStore, stepRecordStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { warpStates } from '../../../stores/warpStates';
import { setStretchMode } from '../../warp/setStretchMode';
import { prepareClipGlue } from '../prepareClipGlue';
import { restoreClipGlueState } from '../restoreClipGlueState';

// `applyClipAutomationLaneTransition` is the one call `restoreClipGlueState`
// makes that can refuse AFTER the satellite migration has committed — its own
// contract says a store that refuses the write outright is reported as
// `false`. Forcing that answer is the only way to observe what the rejection
// leaves behind, since the automation store accepts every well-formed lane.
const mocks = vi.hoisted(() => ({ applyClipAutomationLaneTransition: vi.fn() }));

vi.mock('../../clip/applyClipAutomationLaneTransition', () => ({
    applyClipAutomationLaneTransition: mocks.applyClipAutomationLaneTransition,
}));

describe('restoreClipGlueState satellite rollback', () => {
    beforeEach(() => {
        mocks.applyClipAutomationLaneTransition.mockReturnValue(true);
        const first = ClipDummy.create({
            id: 'clip-a',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 8,
            endBeat: 12,
            midiOffsetBeats: 2,
        });
        const second = ClipDummy.create({
            id: 'clip-b',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 12,
            endBeat: 16,
            midiOffsetBeats: 1,
        });
        const track = TrackDummy.create({ id: 'track-midi', kind: 'midi', clips: [first, second] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({ notesByClipId: { 'clip-a': [], 'clip-b': [] }, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        takeLaneStore.set({ lanes: [] });
        stepRecordStore.set(null);
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        takeLaneStore.set({ lanes: [] });
        stepRecordStore.set(null);
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    it('reverts the migrated warp state when the automation transition refuses after it committed', () => {
        setStretchMode('clip-a', 'repitch');
        const plan = prepareClipGlue({ clipIds: ['clip-a', 'clip-b'] });
        expect(plan).not.toBeNull();
        const { previous, next, targetClipId: gluedId } = plan!;

        mocks.applyClipAutomationLaneTransition.mockReturnValue(false);
        expect(restoreClipGlueState({ expected: previous, replacement: next })).toBe(false);

        // `warpStates` is a plain module-level `Map`, so it is NOT in the
        // Automerge transaction the caller aborts on a rejection. If this
        // call does not revert the migration itself, warp markers stay
        // attached to a glued clip id that the abort has just un-created.
        expect(warpStates.has('clip-a')).toBe(true);
        expect(warpStates.has(gluedId)).toBe(false);
        expect(warpStates.has('clip-b')).toBe(false);
    });

    it('reverts a migrated gain envelope on the same rejection', () => {
        const envelope = { clipId: 'clip-a', enabled: true, points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }] };
        setEnvelope('clip-a', envelope);
        const plan = prepareClipGlue({ clipIds: ['clip-a', 'clip-b'] });
        expect(plan).not.toBeNull();
        const { previous, next, targetClipId: gluedId } = plan!;

        mocks.applyClipAutomationLaneTransition.mockReturnValue(false);
        expect(restoreClipGlueState({ expected: previous, replacement: next })).toBe(false);

        expect(getEnvelope('clip-a')).toEqual(envelope);
        expect(getEnvelope(gluedId)).toBeUndefined();
    });

    it('reverts the satellites on the undo direction too, where the migration runs the other way', () => {
        setStretchMode('clip-a', 'repitch');
        const plan = prepareClipGlue({ clipIds: ['clip-a', 'clip-b'] });
        const { previous, next, targetClipId: gluedId } = plan!;
        expect(restoreClipGlueState({ expected: previous, replacement: next })).toBe(true);
        expect(warpStates.has(gluedId)).toBe(true);

        // Undo swaps the arguments, so the satellite transition now moves the
        // entry off the glued clip and back onto clip-a. A rejection here must
        // leave it on the glued clip, matching the arrangement every other
        // store still holds.
        mocks.applyClipAutomationLaneTransition.mockReturnValue(false);
        expect(restoreClipGlueState({ expected: next, replacement: previous })).toBe(false);

        expect(warpStates.has(gluedId)).toBe(true);
        expect(warpStates.has('clip-a')).toBe(false);
    });
});
