import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    forgetStoredControllerEngagements,
    noteStoredControllerMove,
} from '../../../services/storedControllerEngagement';
import { stopPlayheadScheduler } from '../stopPlayheadScheduler';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    stopAllScheduled: vi.fn(),
    stopAudioRecording: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48_000 })),
    cancelTrackAutomationRamps: vi.fn(),
    getTrackStrip: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    stopAutomationRecording: vi.fn(),
}));

function grandBouleControls() {
    return { setSustain: vi.fn(), setSostenuto: vi.fn(), setUnaCorda: vi.fn() };
}

function stripOf(deviceNodes: Record<string, unknown>[]) {
    return { deviceNodes } as never;
}

describe('stopPlayheadScheduler releasing stored pedals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetStoredControllerEngagements();
    });

    it('lifts a pedal stored playback left down on that device only, never one the user holds live', () => {
        const playedBack = grandBouleControls();
        const heldLive = grandBouleControls();
        const heldLiveOnSameTrack = grandBouleControls();
        const stripsByTrack = {
            'played-back-track': stripOf([
                { deviceId: 'gb-played-back', grandBouleControls: playedBack },
                { deviceId: 'gb-held-live-same-track', grandBouleControls: heldLiveOnSameTrack },
            ]),
            'held-live-track': stripOf([{ deviceId: 'gb-held-live', grandBouleControls: heldLive }]),
        };
        vi.mocked(getTrackStrip).mockImplementation((trackId) => stripsByTrack[trackId as keyof typeof stripsByTrack]);
        noteStoredControllerMove({
            trackId: 'played-back-track',
            deviceId: 'gb-played-back',
            deviceType: 'grand-boule',
            controller: 64,
            engaged: true,
        });

        stopPlayheadScheduler();

        // Frameless: a move with no frame applies at once and supersedes any
        // framed move of stored playback still queued in the engine.
        expect(playedBack.setSustain).toHaveBeenCalledExactlyOnceWith(0);
        expect(playedBack.setSostenuto).not.toHaveBeenCalled();
        expect(playedBack.setUnaCorda).not.toHaveBeenCalled();
        expect(heldLive.setSustain).not.toHaveBeenCalled();
        expect(heldLive.setSostenuto).not.toHaveBeenCalled();
        expect(heldLive.setUnaCorda).not.toHaveBeenCalled();
        expect(heldLiveOnSameTrack.setSustain).not.toHaveBeenCalled();
        expect(heldLiveOnSameTrack.setSostenuto).not.toHaveBeenCalled();
        expect(heldLiveOnSameTrack.setUnaCorda).not.toHaveBeenCalled();
    });

    it('releases exactly the pedals left engaged, each through its own control', () => {
        const controls = grandBouleControls();
        vi.mocked(getTrackStrip).mockReturnValue(stripOf([{ deviceId: 'gb-1', grandBouleControls: controls }]));
        for (const controller of [64, 66, 67]) {
            noteStoredControllerMove({
                trackId: 'track-1',
                deviceId: 'gb-1',
                deviceType: 'grand-boule',
                controller,
                engaged: true,
            });
        }
        noteStoredControllerMove({
            trackId: 'track-1',
            deviceId: 'gb-1',
            deviceType: 'grand-boule',
            controller: 66,
            engaged: false,
        });

        stopPlayheadScheduler();

        expect(controls.setSustain).toHaveBeenCalledExactlyOnceWith(0);
        expect(controls.setSostenuto).not.toHaveBeenCalled();
        expect(controls.setUnaCorda).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('lifts a Levain sustain stored playback left down, as a frameless controller 64 at zero', () => {
        const handleCc = vi.fn();
        vi.mocked(getTrackStrip).mockReturnValue(stripOf([{ deviceId: 'levain-1', levainControls: { handleCc } }]));
        noteStoredControllerMove({
            trackId: 'track-1',
            deviceId: 'levain-1',
            deviceType: 'levain',
            controller: 64,
            engaged: true,
        });

        stopPlayheadScheduler();

        expect(handleCc).toHaveBeenCalledExactlyOnceWith(64, 0);
    });

    it('releases a pedal once: a second stop sends nothing', () => {
        const controls = grandBouleControls();
        vi.mocked(getTrackStrip).mockReturnValue(stripOf([{ deviceId: 'gb-1', grandBouleControls: controls }]));
        noteStoredControllerMove({
            trackId: 'track-1',
            deviceId: 'gb-1',
            deviceType: 'grand-boule',
            controller: 64,
            engaged: true,
        });

        stopPlayheadScheduler();
        stopPlayheadScheduler();

        expect(controls.setSustain).toHaveBeenCalledTimes(1);
    });

    it('reads no strip when stored playback engaged nothing', () => {
        stopPlayheadScheduler();

        expect(getTrackStrip).not.toHaveBeenCalled();
    });
});
