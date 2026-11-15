import { describe, expect, it } from 'vitest';

import { type ClipSatelliteEntrySnapshot, type ClipSplitActionSnapshot } from '#/utils/handlerContract';

import {
    clipSatelliteReplacementByActionType,
    getClipSatelliteReplacements,
} from '../clipSatelliteReplacementByActionType';

const satellites: readonly ClipSatelliteEntrySnapshot[] = [{ clipId: 'c1', gainEnvelope: null, warpState: null }];

function splitSnapshot(clipSatellites: readonly ClipSatelliteEntrySnapshot[] | undefined): ClipSplitActionSnapshot {
    const clip = {
        id: 'c1',
        trackId: 't1',
        name: 'c1',
        startBeat: 0,
        endBeat: 4,
        type: 'audio' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
    const emptyMidi = {
        notes: { present: false, value: [] },
        controlChanges: { present: false, value: [] },
        pitchBends: { present: false, value: [] },
    };
    return {
        trackId: 't1',
        leftClip: clip,
        rightClip: { ...clip, id: 'c2' },
        rightClipIndex: 1,
        sourceMidi: emptyMidi,
        rightMidi: emptyMidi,
        clipSatellites,
    };
}

describe('clipSatelliteReplacementByActionType', () => {
    it('gives exactly the two clip restores a replacement', () => {
        const withReplacement = Object.entries(clipSatelliteReplacementByActionType)
            .filter(([, read]) => read !== clipSatelliteReplacementByActionType.addTrack)
            .map(([type]) => type);

        expect(withReplacement.toSorted()).toEqual(['restoreClip', 'restoreClipSplitState']);
    });

    it('reads the ripple plan satellites of a restoreClip', () => {
        expect(
            getClipSatelliteReplacements({
                type: 'restoreClip',
                payload: {
                    clipId: 'c1',
                    trackId: 't1',
                    clipSnapshot: { id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 },
                    ripplePlan: {
                        removedClips: [],
                        shiftedClips: [],
                        clipSatellites: satellites,
                        clipAutomationLanes: [],
                    },
                    midiNotesSnapshot: null,
                    midiCcSnapshot: null,
                    midiPitchBendSnapshot: null,
                },
            })
        ).toBe(satellites);
    });

    it('reads no satellites from a restoreClip without a ripple plan', () => {
        expect(
            getClipSatelliteReplacements({
                type: 'restoreClip',
                payload: {
                    clipId: 'c1',
                    trackId: 't1',
                    clipSnapshot: { id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 },
                    ripplePlan: null,
                    midiNotesSnapshot: null,
                    midiCcSnapshot: null,
                    midiPitchBendSnapshot: null,
                },
            })
        ).toBeUndefined();
    });

    it('reads the replacement satellites of a restoreClipSplitState', () => {
        expect(
            getClipSatelliteReplacements({
                type: 'restoreClipSplitState',
                payload: {
                    clipId: 'c1',
                    rightClipId: 'c2',
                    expected: splitSnapshot(undefined),
                    replacement: splitSnapshot(satellites),
                },
            })
        ).toBe(satellites);
    });

    it('reads no satellites from any other action', () => {
        expect(
            getClipSatelliteReplacements({ type: 'setTrackPan', payload: { trackId: 't1', pan: 0, expectedPan: 0 } })
        ).toBeUndefined();
    });
});
