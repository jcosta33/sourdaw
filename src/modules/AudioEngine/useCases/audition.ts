import { audioEngine } from '../repositories/audioEngineInstance';
import { getSynthParamsForTrack, scheduleNote } from './builtinSynth';
import { getTrackById } from '#/modules/Track/useCases/trackQueries';
import { getDrumKitDefByIndex, scheduleDrumKitNote } from './drumSynthEngine';

/**
 * Starts a live audition note on a track.
 * Detects whether the track has a drum kit device and routes to the
 * dedicated drum synthesis engine, otherwise uses the built-in synth.
 * Returns a callback function to stop the note.
 */
export function playAuditionNote(trackId: string, pitch: number, velocity: number = 100): () => void {
    const engine = audioEngine;
    const strip = engine.ensureTrackStrip(trackId);
    const now = engine.context.currentTime;

    // Check if this track has a drum kit device
    const track = getTrackById(trackId);
    const drumDevice = track?.devices.find(
        (d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit' || d.type.startsWith('builtin-drum-machine')
    );

    if (drumDevice) {
        // Route to the dedicated drum synthesis engine (one-shot, fire-and-forget)
        const kitIndex = drumDevice.parameterValues.kit ?? drumDevice.parameterValues.kitId ?? 0;
        const kitDef = getDrumKitDefByIndex(kitIndex);
        if (kitDef) {
            scheduleDrumKitNote(
                engine.context,
                strip.gainNode,
                kitDef,
                pitch,
                now,
                velocity
            );
        }
        // Drums are one-shots — the stop callback is a no-op
        return () => {};
    }

    // Regular synth path
    const synthParams = getSynthParamsForTrack(trackId);
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
