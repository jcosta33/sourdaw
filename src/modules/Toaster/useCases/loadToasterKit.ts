import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type ToasterKit, type DrumEngineType } from '../models/ToasterKit';
import { loadKit } from '../stores/toasterStore';

/**
 * Map TS engine type to Rust DrumEngineType index.
 * Must match toaster/src/pad.rs set_param("engine_type") match arms.
 *
 * Indices 0-12: generic/legacy engines
 * Indices 13-28: circuit-faithful engines (808/909/CR-78)
 */
export const TOASTER_ENGINE_MAP: Record<DrumEngineType, number> = {
    // Circuit-faithful 808 (indices 13-26)
    'kick-808': 13,
    'snare-808': 15,
    'hihat-closed': 16,
    'hihat-open': 16,
    clap: 18,
    cowbell: 23,
    clave: 24,
    rimshot: 25,
    maracas: 26,
    'tom-808-low': 20,
    'tom-808-mid': 21,
    'tom-808-high': 22,
    // Circuit-faithful 909 (indices 14, 17, 19)
    'kick-909': 14,
    'clap-909': 19,
    'hihat-909': 17,
    // CR-78 (indices 27-28)
    'cr78-drum': 27,
    'cr78-metallic': 28,
    // Generic / analog voices (indices 0-12)
    'kick-analog': 0,
    'snare-analog': 1,
    tom: 5,
    cymbal: 6,
    shaker: 11,
    'perc-generic': 4,
    // Melodic / textural
    'modal-tabla': 7,
    'modal-bongo': 7,
    'modal-woodblock': 7,
    'modal-metal': 7,
    'fm-perc': 8,
    sample: 4,
};

export const getToasterControlsDependencies = {
    getAllTracks,
    getTrackStrip,
} as const;

export function getToasterControls(): {
    setPadParam: (pad: number, name: string, value: number) => void;
    setParam: (name: string, value: number) => void;
} | null {
    const tracks = getAllTracks();
    const toasterTrack = tracks.find((t) => t.devices.some((d) => d.type === 'toaster'));
    if (!toasterTrack) {
        return null;
    }

    const strip = getTrackStrip(toasterTrack.id);
    if (!strip) {
        return null;
    }

    const dn = strip.deviceNodes.find((d) => d.toasterControls?.ready);
    return dn?.toasterControls ?? null;
}

export function loadToasterKitPreset(kit: ToasterKit): void {
    // Update the UI store first
    loadKit(kit);

    // Forward to the WASM engine
    const controls = getToasterControls();
    if (!controls) {
        return;
    }

    // Kit-level params (snake_case for Rust)
    controls.setParam('master_gain', kit.masterGain);
    controls.setParam('reverb_mix', kit.reverbMix);
    controls.setParam('reverb_decay', kit.reverbDecay);
    controls.setParam('delay_time', kit.delayTime);
    controls.setParam('delay_feedback', kit.delayFeedback);
    controls.setParam('delay_mix', kit.delayMix);
    controls.setParam('lofi_bits', kit.lofiBits);
    controls.setParam('lofi_rate', kit.lofiRate);
    controls.setParam('lofi_mix', kit.lofiMix);

    // Per-pad params (snake_case for Rust)
    for (let i = 0; i < kit.pads.length; i++) {
        const pad = kit.pads[i]!;
        const engineIdx = TOASTER_ENGINE_MAP[pad.engineType] ?? 0;
        controls.setPadParam(i, 'engine_type', engineIdx);

        if (pad.engineType === 'hihat-open') {
            controls.setPadParam(i, 'open', 1);
        }
        if (pad.engineType === 'hihat-closed') {
            controls.setPadParam(i, 'open', 0);
        }

        controls.setPadParam(i, 'volume', pad.volume);
        controls.setPadParam(i, 'pan', pad.pan);
        controls.setPadParam(i, 'tune', pad.tune);
        controls.setPadParam(i, 'decay', pad.decay);
        controls.setPadParam(i, 'tone', pad.tone);
        controls.setPadParam(i, 'drive', pad.drive);
        controls.setPadParam(i, 'filter_cutoff', pad.filterCutoff);
        controls.setPadParam(i, 'filter_resonance', pad.filterResonance);
        controls.setPadParam(i, 'send_reverb', pad.sendReverb);
        controls.setPadParam(i, 'send_delay', pad.sendDelay);

        if (pad.engineParams) {
            for (const [key, value] of Object.entries(pad.engineParams)) {
                controls.setPadParam(i, key, value);
            }
        }
    }
}
