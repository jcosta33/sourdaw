import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
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
 * These cases assert the undo lands, which is the thing the user experiences.
 *
 * A Toaster pad child is the regression case (#2458): the fader used to mirror
 * onto the pad's `volume`, whose range stops at unity, so the strip was held
 * there too — and an above-unity move recorded an inverse whose `expectedGain`
 * the stored value could never match, making the pre-move gain unrecoverable.
 * The mirror is gone: the pad keeps its own level and the strip keeps the full
 * fader law, so a pad track must now round-trip exactly like any other.
 */
describe('handleSetTrackGain — undo across a clamped write', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stores a pad track boost inside the fader headroom at the requested value and undoes it', () => {
        primeTracks(0.4, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PAD_CHILD_ID, gain: 1.6, expectedGain: 0.4 },
        };

        const described = handleSetTrackGain.describe?.(action);
        expect(handleSetTrackGain.execute(action)).toEqual({ status: 'written' });
        // The full requested boost, not unity — the pad no longer caps the strip.
        expect(gainOf(PAD_CHILD_ID)).toBe(1.6);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(0.4);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.redoAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(1.6);
    });

    it('clamps only at the fader law ceiling, and the clamped write still undoes', () => {
        primeTracks(0.4, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PAD_CHILD_ID, gain: 2.5, expectedGain: 0.4 },
        };

        const described = handleSetTrackGain.describe?.(action);
        expect(handleSetTrackGain.execute(action)).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(FADER_MAX_GAIN);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(0.4);
    });

    /**
     * The other leg of the old asymmetry, and the one the store — not the
     * payload — created: a track parked in the fader headroom before a Toaster
     * appeared above it held a gain the writer refused on the way back, so undo
     * landed on unity and the paired redo — still expecting 1.6 — conflicted.
     * The restore must now land on the parked value in full.
     */
    it('restores a pad track parked in the fader headroom in full', () => {
        primeTracks(1.6, 0.4);
        const action = {
            type: 'setTrackGain' as const,
            payload: { trackId: PAD_CHILD_ID, gain: 0.3, expectedGain: 1.6 },
        };

        const described = handleSetTrackGain.describe?.(action);
        expect(handleSetTrackGain.execute(action)).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(0.3);

        expect(handleSetTrackGain.execute(asSetTrackGain(described?.inverseAction))).toEqual({ status: 'written' });
        expect(gainOf(PAD_CHILD_ID)).toBe(1.6);

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
