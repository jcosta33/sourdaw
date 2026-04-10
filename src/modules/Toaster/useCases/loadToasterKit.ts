/**
 * Load a Toaster kit — updates the store AND forwards all params to the WASM engine.
 */

import { inject } from '#/infra/di/inject';
import { type ToasterKit, type DrumEngineType } from '../models/ToasterKit';
import { loadKit } from '../stores/toasterStore';
import { getTrackStrip } from '#/modules/AudioEngine/useCases/engineAccess';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';

/**
 * Map TS engine type to Rust DrumEngineType index.
 * Must match toaster/src/pad.rs set_param("engine_type") match arms.
 */
export const TOASTER_ENGINE_MAP: Record<DrumEngineType, number> = {
    'kick-808': 0,
    'kick-909': 0,
    'kick-analog': 0,
    'snare-808': 1,
    'snare-analog': 1,
    'hihat-closed': 2,
    'hihat-open': 2,
    clap: 3,
    cowbell: 9,
    clave: 10,
    rimshot: 12,
    shaker: 11,
    'perc-generic': 4,
    tom: 5,
    cymbal: 6,
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

export const getToasterControls = inject(getToasterControlsDependencies)(({ getAllTracks, getTrackStrip }) =>
    function getToasterControls(): {
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
);

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

        if (pad.engineType === 'hihat-open') controls.setPadParam(i, 'open', 1);
        if (pad.engineType === 'hihat-closed') controls.setPadParam(i, 'open', 0);

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
export type { ToasterKit } from '../models/ToasterKit';
