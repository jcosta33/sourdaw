import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { type ToasterKit, type DrumEngineType } from '../models/ToasterKit';
import { loadKit } from '../stores/toasterStore';

import { getToasterControls } from './getToasterControls';

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

export function loadToasterKitPreset(deviceId: string, kit: ToasterKit): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // Update the UI store first
    loadKit(deviceId, kit);

    // Forward to the WASM engine
    const controls = getToasterControls(deviceId);
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
    for (let index = 0; index < kit.pads.length; index++) {
        const pad = kit.pads[index]!;
        const engineIdx = TOASTER_ENGINE_MAP[pad.engineType];
        controls.setPadParam(index, 'engine_type', engineIdx);

        if (pad.engineType === 'hihat-open') {
            controls.setPadParam(index, 'open', 1);
        }
        if (pad.engineType === 'hihat-closed') {
            controls.setPadParam(index, 'open', 0);
        }

        controls.setPadParam(index, 'volume', pad.volume);
        controls.setPadParam(index, 'pan', pad.pan);
        controls.setPadParam(index, 'tune', pad.tune);
        controls.setPadParam(index, 'decay', pad.decay);
        controls.setPadParam(index, 'tone', pad.tone);
        controls.setPadParam(index, 'drive', pad.drive);
        controls.setPadParam(index, 'filter_cutoff', pad.filterCutoff);
        controls.setPadParam(index, 'filter_resonance', pad.filterResonance);
        controls.setPadParam(index, 'send_reverb', pad.sendReverb);
        controls.setPadParam(index, 'send_delay', pad.sendDelay);

        for (const [key, value] of Object.entries(pad.engineParams)) {
            controls.setPadParam(index, key, value);
        }
    }
}
