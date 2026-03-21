import { audioEngine } from '../repositories/audioEngineInstance';
import { getSynthParamsForTrack, scheduleNote } from './builtinSynth';

/**
 * Starts a live audition note on a track using the built-in synth.
 * Returns a callback function to stop the note.
 */
export function playAuditionNote(trackId: string, pitch: number, velocity: number = 100): () => void {
    const engine = audioEngine;
    const strip = engine.ensureTrackStrip(trackId);
    const synthParams = getSynthParamsForTrack(trackId);
    const now = engine.context.currentTime;

    // Schedule a very long note, return a closure to kill it
    const osc = scheduleNote(
        engine.context,
        strip.gainNode,
        pitch,
        now,
        60, // 60 seconds (stopped manually)
        velocity,
        synthParams
    ) as OscillatorNode & { _env?: GainNode };

    return () => {
        const killTime = engine.context.currentTime;
        const releaseTime = synthParams?.release ?? 0.3;
        if (osc._env) {
            osc._env.gain.cancelScheduledValues(killTime);
            osc._env.gain.setTargetAtTime(0, killTime, releaseTime / 3);
        }
        try {
            osc.stop(killTime + releaseTime + 0.05);
        } catch {
            // already stopped
        }
    };
}
