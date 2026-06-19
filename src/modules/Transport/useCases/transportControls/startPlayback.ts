import { resumeEngine } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { startPlayheadScheduler } from '../playheadScheduler';

export function startPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // Guard against re-entry while already playing. A second spacebar (or any
    // duplicate trigger) would otherwise re-run `startPlayheadScheduler`, which
    // re-snaps `lastTickTime` to the current audio-clock time. The next worker
    // tick then sees `deltaSec ≈ 0`, advances the playhead by ~0 beats, and the
    // transport loses one grain of forward motion. No-op if already running.
    if (state.isPlaying) {
        return;
    }

    void resumeEngine();
    ensureTrackStrips();

    let startPosition = state.playheadPosition;
    if (state.preRollEnabled && state.preRollBars > 0) {
        const preRollBeats = state.preRollBars * state.timeSignatureNumerator;
        startPosition = Math.max(0, startPosition - preRollBeats);
    }

    updateTransportState({ isPlaying: true, playheadPosition: startPosition });
    playheadPositionRef.current = startPosition;
    startPlayheadScheduler();
}
