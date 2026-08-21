import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

const BUS_ID = 'bus-impact';

function busTrack(gain: number): ProjectContextTrack {
    return {
        id: BUS_ID,
        name: 'Impact',
        kind: 'bus',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain,
        pan: 0,
        automationMode: 'read',
        vcaGroupId: null,
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

function contextWithBusGain(gain: number): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 0,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        automationLanes: [],
        sections: [{ id: 'section-verse', name: 'Verse', startBeat: 8, endBeat: 16 }],
        tracks: [busTrack(gain)],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

function materializeLift(gain: number, gainDb: number) {
    return materializeActionStateGuards(
        [{ type: 'automateTrackGainRange', payload: { trackIds: [BUS_ID], sectionName: 'Verse', gainDb } }],
        contextWithBusGain(gain)
    );
}

/**
 * The gate on the action path, which is the one that actually decides whether a
 * lift reaches `handleAutomateTrackGainRange`.
 *
 * The handler admits a lift up to `FADER_MAX_GAIN`, but every route to it runs
 * through a headroom check first — the bridge for a provider call, this
 * materializer for an action, and the vibe-mix scope for the capability. While
 * these read unity, the handler's widened check was unreachable: a bus at the
 * 0.8 default asked for a +3 dB section lift was refused here, and the user was
 * told the bus had no headroom for a move they could make by hand on the fader.
 */
describe('materializeActionStateGuards — automateTrackGainRange headroom', () => {
    it('materializes a lift that lands above unity but inside the fader ceiling', () => {
        // 0.8 x 10^(3/20) ≈ 1.128.
        const result = materializeLift(0.8, 3);

        expect(result.status).toBe('accepted');
        expect(result.status === 'accepted' && result.actions[0]?.type).toBe('automateTrackGainRange');
    });

    it('still rejects a lift that clears the fader ceiling', () => {
        // 1.5 x 10^(6/20) ≈ 2.993, past `FADER_MAX_GAIN`.
        expect(1.5 * 10 ** (6 / 20)).toBeGreaterThan(FADER_MAX_GAIN);

        const result = materializeLift(1.5, 6);

        expect(result.status).toBe('rejected');
        expect(result.status === 'rejected' && result.reason).toContain(BUS_ID);
    });
});
