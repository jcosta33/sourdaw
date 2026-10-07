import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { forgetStoredControllerEngagements } from '../../../services/storedControllerEngagement';
import { postStoredControllerMove } from '../../scheduling/postStoredControllerMove';
import { stopPlayheadScheduler } from '../stopPlayheadScheduler';

/** The device nodes each track's strip holds, as the engine double answers `getTrackStrip`. */
const deviceNodesByTrack = vi.hoisted(() => new Map<string, unknown[]>());

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    stopAllScheduled: vi.fn(),
    stopAudioRecording: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48_000 })),
    cancelTrackAutomationRamps: vi.fn(),
    getTrackStrip: vi.fn((trackId: string) => ({ deviceNodes: deviceNodesByTrack.get(trackId) ?? [] })),
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    stopAutomationRecording: vi.fn(),
}));

function grandBouleControls() {
    return {
        setSustain: vi.fn(),
        setSostenuto: vi.fn(),
        setUnaCorda: vi.fn(),
        discardStoredPedals: vi.fn(),
    };
}

type GrandBouleControls = ReturnType<typeof grandBouleControls>;

/** Post a stored move to a Grand Boule the way playback does (so both records are written), then forget the post's own call. */
function postPedal(controls: GrandBouleControls, trackId: string, deviceId: string, controller: number, value: number) {
    postStoredControllerMove({
        trackId,
        device: { id: deviceId, type: 'grand-boule' },
        node: { grandBouleControls: controls },
        controller,
        value,
        sampleFrame: 24_000,
    });
}

describe('stopPlayheadScheduler releasing stored pedals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        deviceNodesByTrack.clear();
        forgetStoredControllerEngagements();
    });

    it('lifts a pedal stored playback left down on that device only, never one the user holds live', () => {
        const playedBack = grandBouleControls();
        const heldLive = grandBouleControls();
        const heldLiveOnSameTrack = grandBouleControls();
        deviceNodesByTrack.set('played-back-track', [
            { deviceId: 'gb-played-back', grandBouleControls: playedBack },
            { deviceId: 'gb-held-live-same-track', grandBouleControls: heldLiveOnSameTrack },
        ]);
        deviceNodesByTrack.set('held-live-track', [{ deviceId: 'gb-held-live', grandBouleControls: heldLive }]);
        postPedal(playedBack, 'played-back-track', 'gb-played-back', 64, 127);
        playedBack.setSustain.mockClear();

        stopPlayheadScheduler();

        // Frameless, and marked as a stored move: it applies at once, and the
        // framed stored moves still queued are dropped by the discard sent first.
        expect(playedBack.discardStoredPedals).toHaveBeenCalledOnce();
        expect(playedBack.setSustain).toHaveBeenCalledExactlyOnceWith(0, undefined, true);
        expect(playedBack.setSostenuto).not.toHaveBeenCalled();
        expect(playedBack.setUnaCorda).not.toHaveBeenCalled();
        for (const untouched of [heldLive, heldLiveOnSameTrack]) {
            expect(untouched.discardStoredPedals).not.toHaveBeenCalled();
            expect(untouched.setSustain).not.toHaveBeenCalled();
            expect(untouched.setSostenuto).not.toHaveBeenCalled();
            expect(untouched.setUnaCorda).not.toHaveBeenCalled();
        }
    });

    it('lifts every pedal stored playback moved, whether or not its last move left it down, each through its own control', () => {
        // A sostenuto pressed and lifted again, a sustain pressed and a una corda
        // pressed: the post-time record says sostenuto is up, but a lift still
        // queued is dropped by the discard, so the engine may hold any of them down.
        const controls = grandBouleControls();
        deviceNodesByTrack.set('track-1', [{ deviceId: 'gb-1', grandBouleControls: controls }]);
        postPedal(controls, 'track-1', 'gb-1', 64, 127);
        postPedal(controls, 'track-1', 'gb-1', 66, 127);
        postPedal(controls, 'track-1', 'gb-1', 67, 127);
        postPedal(controls, 'track-1', 'gb-1', 66, 0);
        controls.setSustain.mockClear();
        controls.setSostenuto.mockClear();
        controls.setUnaCorda.mockClear();

        stopPlayheadScheduler();

        expect(controls.discardStoredPedals).toHaveBeenCalledOnce();
        expect(controls.setSustain).toHaveBeenCalledExactlyOnceWith(0, undefined, true);
        expect(controls.setSostenuto).toHaveBeenCalledExactlyOnceWith(false, undefined, true);
        expect(controls.setUnaCorda).toHaveBeenCalledExactlyOnceWith(false, undefined, true);
    });

    it('lifts a Levain sustain stored playback left down, as a frameless controller 64 at zero, and writes no other controller', () => {
        const handleCc = vi.fn();
        const discardStoredCc = vi.fn();
        deviceNodesByTrack.set('track-1', [{ deviceId: 'levain-1', levainControls: { handleCc, discardStoredCc } }]);
        const node = { levainControls: { handleCc, discardStoredCc } };
        const device = { id: 'levain-1', type: 'levain' };
        for (const [controller, value] of [
            [64, 127],
            [11, 90],
        ]) {
            postStoredControllerMove({
                trackId: 'track-1',
                device,
                node,
                controller: controller!,
                value: value!,
                sampleFrame: 24_000,
            });
        }
        handleCc.mockClear();

        stopPlayheadScheduler();

        expect(discardStoredCc).toHaveBeenCalledOnce();
        expect(handleCc).toHaveBeenCalledExactlyOnceWith(64, 0, undefined, true);
    });

    it('releases a pedal once: a second stop sends nothing', () => {
        const controls = grandBouleControls();
        deviceNodesByTrack.set('track-1', [{ deviceId: 'gb-1', grandBouleControls: controls }]);
        postPedal(controls, 'track-1', 'gb-1', 64, 127);
        controls.setSustain.mockClear();

        stopPlayheadScheduler();
        stopPlayheadScheduler();

        expect(controls.setSustain).toHaveBeenCalledTimes(1);
        expect(controls.discardStoredPedals).toHaveBeenCalledTimes(1);
    });

    it('reads no strip when stored playback posted nothing', () => {
        stopPlayheadScheduler();

        expect(getTrackStrip).not.toHaveBeenCalled();
    });
});
