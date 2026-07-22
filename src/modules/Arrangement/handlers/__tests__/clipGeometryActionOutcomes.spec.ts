import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, type Track } from '../../models/Track';
import { handleNudgeClip } from '../clip/handleNudgeClip';
import { handleTrimClipEnd } from '../clip/handleTrimClipEnd';
import { handleTrimClipStart } from '../clip/handleTrimClipStart';
import { handleFitClipToBeats } from '../clipStretch/handleFitClipToBeats';
import { handleSetClipStretchMode } from '../clipStretch/handleSetClipStretchMode';
import { handleSetClipStretchRatio } from '../clipStretch/handleSetClipStretchRatio';

type GetTrackState = typeof import('../../repositories/track/getTrackState').getTrackState;
type UpdateClip = typeof import('../../repositories/track/updateClip').updateClip;

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<GetTrackState>(),
    shiftClipAutomation: vi.fn<(clipId: string, deltaBeats: number) => void>(),
    shiftClipMidiNotes: vi.fn<(clipId: string, deltaBeats: number) => void>(),
    updateClip: vi.fn<UpdateClip>(),
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation: mocks.shiftClipAutomation,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    shiftClipMidiNotes: mocks.shiftClipMidiNotes,
}));

function makeClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Clip 1',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
        stretchMode: 'off',
        stretchRatio: 1,
        ...overrides,
    };
}

function makeTrack(clips: Clip[]): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips,
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'track-1-alt',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

const geometryActions = [
    {
        name: 'nudgeClip',
        execute: () =>
            handleNudgeClip.execute({
                type: 'nudgeClip',
                payload: { clipId: 'clip-1', beats: 2 },
            }),
    },
    {
        name: 'trimClipStart',
        execute: () =>
            handleTrimClipStart.execute({
                type: 'trimClipStart',
                payload: { clipId: 'clip-1', newStartBeat: 1 },
            }),
    },
    {
        name: 'trimClipEnd',
        execute: () =>
            handleTrimClipEnd.execute({
                type: 'trimClipEnd',
                payload: { clipId: 'clip-1', newEndBeat: 6 },
            }),
    },
    {
        name: 'fitClipToBeats',
        execute: () =>
            handleFitClipToBeats.execute({
                type: 'fitClipToBeats',
                payload: { clipId: 'clip-1', targetBeats: 8 },
            }),
    },
    {
        name: 'setClipStretchMode',
        execute: () =>
            handleSetClipStretchMode.execute({
                type: 'setClipStretchMode',
                payload: { clipId: 'clip-1', mode: 'timestretch' },
            }),
    },
    {
        name: 'setClipStretchRatio',
        execute: () =>
            handleSetClipStretchRatio.execute({
                type: 'setClipStretchRatio',
                payload: { clipId: 'clip-1', ratio: 2 },
            }),
    },
] as const;

describe('clip geometry action outcomes', () => {
    let currentClip: Clip;

    beforeEach(() => {
        vi.clearAllMocks();
        currentClip = makeClip();
        mocks.getTrackState.mockImplementation(() => ({
            tracks: [makeTrack([currentClip])],
            selectedTrackId: null,
        }));
        mocks.updateClip.mockImplementation((clipId, updater) => {
            if (clipId !== currentClip.id) {
                return false;
            }

            currentClip = updater(currentClip);
            return true;
        });
    });

    it.each(geometryActions)('$name reports no-write when the repository rejects the write', ({ execute }) => {
        mocks.updateClip.mockReturnValue(false);

        expect(execute()).toEqual({ status: 'no-write' });
        expect(mocks.updateClip).toHaveBeenCalledOnce();
    });

    it.each(geometryActions)('$name reports written when the repository commits the write', ({ execute }) => {
        expect(execute()).toEqual({ status: 'written' });
        expect(mocks.updateClip).toHaveBeenCalledOnce();
    });

    it.each([0, -1])('fitClipToBeats rejects target %s before reaching the repository', (targetBeats) => {
        const result = handleFitClipToBeats.execute({
            type: 'fitClipToBeats',
            payload: { clipId: 'clip-1', targetBeats },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('fitClipToBeats rejects missing track state before reaching the repository', () => {
        mocks.getTrackState.mockReturnValue(null);

        const result = handleFitClipToBeats.execute({
            type: 'fitClipToBeats',
            payload: { clipId: 'clip-1', targetBeats: 8 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('fitClipToBeats rejects a missing clip before reaching the repository', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [makeTrack([])],
            selectedTrackId: null,
        });

        const result = handleFitClipToBeats.execute({
            type: 'fitClipToBeats',
            payload: { clipId: 'clip-1', targetBeats: 8 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });

    it('does not shift MIDI notes or automation when a nudge write is rejected', () => {
        mocks.updateClip.mockReturnValue(false);

        const result = handleNudgeClip.execute({
            type: 'nudgeClip',
            payload: { clipId: 'clip-1', beats: 2 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.shiftClipMidiNotes).not.toHaveBeenCalled();
        expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
    });

    it('preserves nudge geometry and shifts dependent MIDI and automation by the applied delta', () => {
        const result = handleNudgeClip.execute({
            type: 'nudgeClip',
            payload: { clipId: 'clip-1', beats: 2 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(currentClip).toMatchObject({ startBeat: 2, endBeat: 6 });
        expect(mocks.shiftClipMidiNotes).toHaveBeenCalledWith('clip-1', 2);
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('clip-1', 2);
    });

    it('preserves trim-start geometry and advances the audio offset', () => {
        currentClip = makeClip({ audioOffsetBeats: 0.5 });

        const result = handleTrimClipStart.execute({
            type: 'trimClipStart',
            payload: { clipId: 'clip-1', newStartBeat: 1 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(currentClip).toMatchObject({ startBeat: 1, endBeat: 4, audioOffsetBeats: 1.5 });
    });

    it('preserves trim-end geometry', () => {
        const result = handleTrimClipEnd.execute({
            type: 'trimClipEnd',
            payload: { clipId: 'clip-1', newEndBeat: 6 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(currentClip).toMatchObject({ startBeat: 0, endBeat: 6 });
    });

    it('preserves fit geometry, ratio math, and off-to-repitch activation', () => {
        const result = handleFitClipToBeats.execute({
            type: 'fitClipToBeats',
            payload: { clipId: 'clip-1', targetBeats: 8 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(currentClip).toMatchObject({
            startBeat: 0,
            endBeat: 8,
            stretchRatio: 0.5,
            stretchMode: 'repitch',
        });
    });

    it('preserves the selected stretch mode', () => {
        const result = handleSetClipStretchMode.execute({
            type: 'setClipStretchMode',
            payload: { clipId: 'clip-1', mode: 'timestretch' },
        });

        expect(result).toEqual({ status: 'written' });
        expect(currentClip.stretchMode).toBe('timestretch');
    });

    it('preserves ratio clamping and repitch duration adjustment', () => {
        currentClip = makeClip({ stretchMode: 'repitch', stretchRatio: 2 });

        const result = handleSetClipStretchRatio.execute({
            type: 'setClipStretchRatio',
            payload: { clipId: 'clip-1', ratio: 10 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(currentClip).toMatchObject({ endBeat: 2, stretchRatio: 4 });
    });
});
