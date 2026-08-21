import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { TOASTER_PAD_MAX_GAIN } from '../../../useCases/setTrackGainPan/isToasterPadTrack';
import { handleSetTrackGain } from '../handleSetTrackGain';

const mocks = vi.hoisted(() => ({
    engineSetTrackGain: vi.fn(),
    updateDeviceParam: vi.fn(),
    recordAutomationValue: vi.fn(),
    captureAutomationRecordingRollback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: mocks.engineSetTrackGain,
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    recordAutomationValue: mocks.recordAutomationValue,
    captureAutomationRecordingRollback: mocks.captureAutomationRecordingRollback,
}));

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

const PAD_PARENT_ID = 'track-toaster';
const PAD_CHILD_ID = 'track-pad-kick';
const PLAIN_ID = 'track-plain';

function primeTracks(padGain: number, plainGain: number): void {
    trackStore.set({
        selectedTrackId: null,
        tracks: [
            TrackDummy.create({
                id: PAD_PARENT_ID,
                name: 'Toaster',
                devices: [
                    { id: 'device-toaster', type: 'toaster', name: 'Toaster', bypassed: false, parameterValues: {} },
                ],
            }),
            TrackDummy.create({ id: PAD_CHILD_ID, name: 'Kick pad', parentId: PAD_PARENT_ID, gain: padGain }),
            TrackDummy.create({ id: PLAIN_ID, name: 'Plain', gain: plainGain }),
        ],
    });
}

function gainOf(trackId: string): number | undefined {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.gain;
}

/** Narrow a described inverse/redo entry to the action this handler executes. */
function asSetTrackGain(action: AppAction | null | undefined): SetTrackGainAction {
    if (!action || action.type !== 'setTrackGain') {
        throw new Error('Expected the described entry to be a setTrackGain action');
    }
    return action;
}

/**
 * The round trip, not the constant.
 *
 * `handleSetTrackGain.describe` predicts what the write will store and hands
 * that prediction to the inverse entry as `expectedGain`; `execute` compares it
 * against project truth on the way back and answers `conflict` when they differ.
 * A Toaster-pad-mirrored track is the one place the writer stores something
 * other than what it was asked for, so a prediction taken from `payload.gain`
 * was wrong exactly there — and the cost is not a mismatched number, it is an
 * undo the user cannot perform and a dead entry occupying one of the shared
 * history's slots. These cases assert the undo lands, which is the thing the
 * user experiences.
 */
describe('handleSetTrackGain — undo across a clamped write', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('undoes a boost asked for above the Toaster pad ceiling back to the pre-move gain', () => {
        primeTracks(0.4, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PAD_CHILD_ID, gain: 1.6, expectedGain: 0.4 },
        };

        const described = handleSetTrackGain.describe?.(action);
        expect(handleSetTrackGain.execute(action)).toEqual({ status: 'written' });
        // The pad's own range, not the fader's: the write landed at unity.
        expect(gainOf(PAD_CHILD_ID)).toBe(TOASTER_PAD_MAX_GAIN);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(0.4);
    });

    it('redoes that same move back onto the value the writer stores', () => {
        primeTracks(0.4, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PAD_CHILD_ID, gain: 1.6, expectedGain: 0.4 },
        };

        const described = handleSetTrackGain.describe?.(action);
        handleSetTrackGain.execute(action);
        handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction));

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.redoAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(TOASTER_PAD_MAX_GAIN);
    });

    /**
     * The other leg of the same asymmetry, and the one the store — not the
     * payload — creates.
     *
     * A track parked in the fader headroom before a Toaster appeared above it
     * holds a gain the writer will refuse the moment undo tries to restore it.
     * The inverse asks for 1.6, the writer stores the pad ceiling, and the redo
     * entry paired with it still expects 1.6 — so the redo conflicts and the
     * user's move is stuck half undone.
     */
    it('redoes after undoing onto a pre-move gain the writer itself clamps', () => {
        primeTracks(1.6, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PAD_CHILD_ID, gain: 0.3, expectedGain: 1.6 },
        };

        const described = handleSetTrackGain.describe?.(action);
        expect(handleSetTrackGain.execute(action)).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(0.3);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction))).toEqual({ status: 'written' });
        // The writer refuses the stored 1.6 on a pad-mirrored track, so undo can
        // only land on the pad ceiling — and the redo must expect that.
        expect(gainOf(PAD_CHILD_ID)).toBe(TOASTER_PAD_MAX_GAIN);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.redoAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(0.3);
    });

    it('still undoes a boost into the fader headroom on a track with no pad behind it', () => {
        primeTracks(0.4, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PLAIN_ID, gain: 1.6, expectedGain: 0.4 },
        };

        const described = handleSetTrackGain.describe?.(action);
        expect(handleSetTrackGain.execute(action)).toEqual({ status: 'written' });
        expect(gainOf(PLAIN_ID)).toBe(1.6);
        expect(gainOf(PLAIN_ID)).toBeLessThan(FADER_MAX_GAIN);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction))).toEqual({ status: 'written' });
        expect(gainOf(PLAIN_ID)).toBe(0.4);
    });
});
