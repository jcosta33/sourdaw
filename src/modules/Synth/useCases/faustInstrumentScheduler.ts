/**
 * Faust instrument note scheduling.
 *
 * Routes MIDI note events to Faust AudioWorkletNode parameters (freq, gain, gate)
 * instead of creating builtin oscillator nodes.
 *
 * Faust instruments are monophonic generators — they use button("gate"),
 * hslider("freq"), and hslider("gain") as standard Faust UI controls.
 *
 * IMPORTANT: faustwasm names AudioParams with full Faust address paths,
 * e.g. "/Physical_Model_String/freq" instead of just "freq".
 * We resolve params by matching the last path segment.
 */

import { type TrackChannelStrip } from '#/modules/AudioEngine/models/AudioEngineState';

/**
 * Find an AudioParam by its short name (last segment of the Faust address path).
 * Faust generates paths like "/InstrumentName/freq" — we match by the tail.
 */
function findParam(worklet: AudioWorkletNode, shortName: string): AudioParam | null {
    // Try exact match first (unlikely for Faust but cheap)
    const exact = worklet.parameters.get(shortName);
    if (exact) {
        return exact;
    }

    // Iterate and match by suffix
    for (const [key, param] of worklet.parameters) {
        if (key === shortName || key.endsWith(`/${shortName}`)) {
            return param;
        }
    }
    return null;
}

/**
 * Find the Faust instrument AudioWorkletNode in a track's device chain.
 * Returns null if no Faust instrument is present (the track uses builtin synth).
 */
export function getFaustInstrumentNode(strip: TrackChannelStrip): AudioWorkletNode | null {
    for (const dn of strip.deviceNodes) {
        if (dn.type.startsWith('faust-') && dn.inputNode.numberOfInputs === 0) {
            // This is a Faust generator (instrument), not an effect
            const node = dn.nodes[0];
            if (node && node instanceof AudioWorkletNode) {
                return node;
            }
        }
    }
    return null;
}

/**
 * Schedule a note on a Faust instrument AudioWorkletNode.
 * Sets freq, gain, and gate AudioParams with proper timing.
 */
export function scheduleFaustNote(
    worklet: AudioWorkletNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number
): void {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const gain = velocity / 127;

    const freqParam = findParam(worklet, 'freq');
    const gainParam = findParam(worklet, 'gain');
    const gateParam = findParam(worklet, 'gate');

    if (freqParam) {
        freqParam.setValueAtTime(frequency, startTime);
    }
    if (gainParam) {
        gainParam.setValueAtTime(gain, startTime);
    }
    if (gateParam) {
        gateParam.setValueAtTime(1, startTime);
        gateParam.setValueAtTime(0, startTime + duration);
    }
}

/**
 * Start a sustained note on a Faust instrument (for audition / live play).
 * Returns a stop callback.
 */
export function startFaustNote(
    worklet: AudioWorkletNode,
    pitch: number,
    velocity: number,
    currentTime: number
): () => void {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const gain = velocity / 127;

    const freqParam = findParam(worklet, 'freq');
    const gainParam = findParam(worklet, 'gain');
    const gateParam = findParam(worklet, 'gate');

    if (freqParam) {
        freqParam.setValueAtTime(frequency, currentTime);
    }
    if (gainParam) {
        gainParam.setValueAtTime(gain, currentTime);
    }
    if (gateParam) {
        gateParam.setValueAtTime(1, currentTime);
    }

    return () => {
        if (gateParam) {
            gateParam.setValueAtTime(0, worklet.context.currentTime);
        }
    };
}
