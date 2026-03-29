/**
 * Load a Grinder kit — updates the store AND forwards all params to the WASM engine.
 */

import { type GrinderKit, type DrumEngineType } from '../models/GrinderKit';
import { loadKit } from '../stores/grinderStore';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { getAllTracks } from '#/modules/Arrangement/repositories/track/queries';

/**
 * Map TS engine type to Rust DrumEngineType index.
 * Must match grinder/src/pad.rs set_param("engine_type") match arms.
 */
export const ENGINE_TYPE_TO_INDEX: Record<DrumEngineType, number> = {
    'kick-808': 0, 'kick-909': 0, 'kick-analog': 0,
    'snare-808': 1, 'snare-analog': 1,
    'hihat-closed': 2, 'hihat-open': 2,
    'clap': 3,
    'cowbell': 4, 'clave': 4, 'rimshot': 4, 'shaker': 4, 'perc-generic': 4,
    'tom': 5,
    'cymbal': 6,
    'modal-tabla': 7, 'modal-bongo': 7, 'modal-woodblock': 7, 'modal-metal': 7,
    'fm-perc': 8,
    'sample': 4,
};

export function getGrinderControls(): { setPadParam: (pad: number, name: string, value: number) => void; setParam: (name: string, value: number) => void } | null {
    const tracks = getAllTracks();
    const grinderTrack = tracks.find((t) => t.devices.some((d) => d.type === 'grinder'));
    if (!grinderTrack) { return null; }

    const strip = audioEngine.getTrackStrip(grinderTrack.id);
    if (!strip) { return null; }

    const dn = strip.deviceNodes.find((d) => d.grinderControls?.ready);
    return dn?.grinderControls ?? null;
}

export function loadGrinderKitPreset(kit: GrinderKit): void {
    // Update the UI store first
    loadKit(kit);

    // Forward to the WASM engine
    const controls = getGrinderControls();
    if (!controls) { return; }

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
        const engineIdx = ENGINE_TYPE_TO_INDEX[pad.engineType] ?? 0;
        controls.setPadParam(i, 'engine_type', engineIdx);
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
    }
}
