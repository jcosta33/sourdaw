/**
 * Proof mastering suite store — patch state + real-time metering data.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ProofPatch, DEFAULT_PATCH } from '../models/ProofPatch';
import { type ProofMeterData } from '#/modules/AudioEngine/engine/ProofNode';

const logger = Container.getInstance().get(Logger);

export type ProofState = {
    patch: ProofPatch;
    uiLevel: 1 | 2 | 3 | 4 | 5;

    // Real-time metering from WASM
    inputLufs: number;
    outputLufs: number;
    outputStLufs: number;
    integratedLufs: number;
    truePeakDb: number;
    lra: number;
    correlation: number;
    limiterGrDb: number;
    dynGr: [number, number, number, number];
    tapPeaks: Array<{ peakL: number; peakR: number }>;
    latency: number;
    abBypass: boolean;
};

const defaultState: ProofState = {
    patch: { ...DEFAULT_PATCH },
    uiLevel: 1,
    inputLufs: -100,
    outputLufs: -100,
    outputStLufs: -100,
    integratedLufs: -100,
    truePeakDb: -100,
    lra: 0,
    correlation: 1,
    limiterGrDb: 0,
    dynGr: [0, 0, 0, 0],
    tapPeaks: Array.from({ length: 6 }, () => ({ peakL: -100, peakR: -100 })),
    latency: 0,
    abBypass: false,
};

export const proofStore = new Store<ProofState>(logger, { initialData: defaultState });

export function setProofUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = proofStore.value;
    if (state) {
        proofStore.set({ ...state, uiLevel: level });
    }
}

export function updateProofPatch(patch: Partial<ProofPatch>): void {
    const state = proofStore.value;
    if (state) {
        proofStore.set({ ...state, patch: { ...state.patch, ...patch } });
    }
}

export function loadProofPatch(patch: ProofPatch): void {
    const state = proofStore.value;
    if (state) {
        proofStore.set({ ...state, patch });
    }
}

export function updateProofMeters(meters: ProofMeterData): void {
    const state = proofStore.value;
    if (state) {
        proofStore.set({
            ...state,
            inputLufs: meters.inputLufs,
            outputLufs: meters.outputLufs,
            outputStLufs: meters.outputStLufs,
            integratedLufs: meters.integratedLufs,
            truePeakDb: meters.truePeakDb,
            lra: meters.lra,
            correlation: meters.correlation,
            limiterGrDb: meters.limiterGrDb,
            dynGr: meters.dynGr,
            tapPeaks: meters.tapPeaks,
            latency: meters.latency,
        });
    }
}
