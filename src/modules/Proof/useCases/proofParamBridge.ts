/**
 * Proof param bridge — sends parameter changes to the WASM audio engine.
 *
 * Registered when the ProofNode is created; called by UI controls.
 */

import { type ProofPatch } from '../models/ProofPatch';
import { updateProofPatch, proofStore } from '../stores/proofStore';

type ProofAudioBridge = {
    setParam: (name: string, value: number) => void;
    reorderModules: (order: [number, number, number, number, number]) => void;
    resetIntegrated: () => void;
};

let bridge: ProofAudioBridge | null = null;

export function registerProofDevice(b: ProofAudioBridge): void {
    bridge = b;
}

export function unregisterProofDevice(): void {
    bridge = null;
}

export function setProofParam(name: string, value: number): void {
    bridge?.setParam(name, value);
}

/** Set a patch parameter and send to audio engine. */
export function setProofParamWithPatch<K extends keyof ProofPatch>(key: K, value: ProofPatch[K]): void {
    updateProofPatch({ [key]: value });

    // Map patch key to DSP param name and send
    if (key === 'inputGain') bridge?.setParam('input_gain', value as number);
    else if (key === 'outputGain') bridge?.setParam('output_gain', value as number);
    else if (key === 'eqBypassed') bridge?.setParam('eq_bypass', (value as boolean) ? 1 : 0);
    else if (key === 'dynBypassed') bridge?.setParam('dyn_bypass', (value as boolean) ? 1 : 0);
    else if (key === 'imgBypassed') bridge?.setParam('img_bypass', (value as boolean) ? 1 : 0);
    else if (key === 'excBypassed') bridge?.setParam('exc_bypass', (value as boolean) ? 1 : 0);
    else if (key === 'limBypassed') bridge?.setParam('lim_bypass', (value as boolean) ? 1 : 0);
    else if (key === 'limCeiling') bridge?.setParam('lim_ceiling', value as number);
    else if (key === 'limRelease') bridge?.setParam('lim_release', value as number);
    else if (key === 'limLookahead') bridge?.setParam('lim_lookahead', value as number);
    else if (key === 'imgAutoMonoBass') bridge?.setParam('img_auto_mono_bass', (value as boolean) ? 1 : 0);
    else if (key === 'imgMonoBassFreq') bridge?.setParam('img_mono_bass_freq', value as number);
}

/** Send all EQ band parameters to the engine. */
export function syncEqBands(): void {
    const patch = proofStore.value?.patch;
    if (!patch || !bridge) return;
    for (let i = 0; i < patch.eqBands.length; i++) {
        const band = patch.eqBands[i]!;
        bridge.setParam(`eq_band${i}_freq`, band.freq);
        bridge.setParam(`eq_band${i}_gain`, band.gain);
        bridge.setParam(`eq_band${i}_q`, band.q);
        bridge.setParam(`eq_band${i}_type`, band.type);
        bridge.setParam(`eq_band${i}_channel`, band.channel);
        bridge.setParam(`eq_band${i}_enabled`, band.enabled ? 1 : 0);
    }
}

/** Send all dynamics band parameters to the engine. */
export function syncDynBands(): void {
    const patch = proofStore.value?.patch;
    if (!patch || !bridge) return;
    for (let i = 0; i < 3; i++) {
        bridge.setParam(`dyn_xover${i}`, patch.dynCrossoverFreqs[i]!);
    }
    for (let i = 0; i < patch.dynBands.length; i++) {
        const band = patch.dynBands[i]!;
        bridge.setParam(`dyn_band${i}_threshold`, band.threshold);
        bridge.setParam(`dyn_band${i}_ratio`, band.ratio);
        bridge.setParam(`dyn_band${i}_attack`, band.attack);
        bridge.setParam(`dyn_band${i}_release`, band.release);
        bridge.setParam(`dyn_band${i}_knee`, band.knee);
        bridge.setParam(`dyn_band${i}_makeup`, band.makeup);
        bridge.setParam(`dyn_band${i}_auto_makeup`, band.autoMakeup ? 1 : 0);
        bridge.setParam(`dyn_band${i}_bypass`, band.bypassed ? 1 : 0);
    }
}

/** Send all imager parameters to the engine. */
export function syncImager(): void {
    const patch = proofStore.value?.patch;
    if (!patch || !bridge) return;
    for (let i = 0; i < 4; i++) {
        bridge.setParam(`img_width${i}`, patch.imgBandWidth[i]!);
    }
    bridge.setParam('img_auto_mono_bass', patch.imgAutoMonoBass ? 1 : 0);
    bridge.setParam('img_mono_bass_freq', patch.imgMonoBassFreq);
}

/** Send all exciter parameters to the engine. */
export function syncExciter(): void {
    const patch = proofStore.value?.patch;
    if (!patch || !bridge) return;
    for (let i = 0; i < patch.excBands.length; i++) {
        const band = patch.excBands[i]!;
        bridge.setParam(`exc_band${i}_type`, band.type);
        bridge.setParam(`exc_band${i}_drive`, band.drive);
        bridge.setParam(`exc_band${i}_blend`, band.blend);
        bridge.setParam(`exc_band${i}_enabled`, band.enabled ? 1 : 0);
    }
}

/** Send full patch to engine (e.g., after preset load). */
export function syncFullPatch(): void {
    const patch = proofStore.value?.patch;
    if (!patch || !bridge) return;

    bridge.setParam('input_gain', patch.inputGain);
    bridge.setParam('output_gain', patch.outputGain);
    bridge.setParam('eq_bypass', patch.eqBypassed ? 1 : 0);
    bridge.setParam('dyn_bypass', patch.dynBypassed ? 1 : 0);
    bridge.setParam('img_bypass', patch.imgBypassed ? 1 : 0);
    bridge.setParam('exc_bypass', patch.excBypassed ? 1 : 0);
    bridge.setParam('lim_bypass', patch.limBypassed ? 1 : 0);
    bridge.setParam('lim_ceiling', patch.limCeiling);
    bridge.setParam('lim_release', patch.limRelease);
    bridge.setParam('lim_lookahead', patch.limLookahead);
    bridge.setParam('dither_mode', patch.ditherMode === 'off' ? 0 : patch.ditherMode === 'tpdf' ? 1 : 2);
    bridge.setParam('dither_bits', patch.ditherBits);

    syncEqBands();
    syncDynBands();
    syncImager();
    syncExciter();

    bridge.reorderModules(patch.chainOrder);
}

export function reorderChain(order: [number, number, number, number, number]): void {
    updateProofPatch({ chainOrder: order });
    bridge?.reorderModules(order);
}

export function resetIntegratedMeters(): void {
    bridge?.resetIntegrated();
}
