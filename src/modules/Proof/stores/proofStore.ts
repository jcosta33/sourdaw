/**
 * Proof mastering suite store — patch state + real-time metering data.
 * Keyed by deviceId to support multiple simultaneous instances.
 */

import { createStore } from '#/infra/store/createStore';

import { type ProofPatch, DEFAULT_PATCH } from '../models/ProofPatch';

/**
 * Real-time metering data shape pushed from the WASM audio engine.
 *
 * Defined locally to avoid importing from AudioEngine/engine/ (private internal).
 * Must remain structurally compatible with the ProofMeterData type in AudioEngine.
 */
export type ProofMeterData = {
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
};

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

export const DEFAULT_PROOF_STATE: ProofState = {
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

type ProofInstances = Record<string, ProofState>;

export const proofStore = createStore<ProofInstances>({ initialData: {} });

export function getProofState(deviceId: string): ProofState {
    return proofStore.value?.[deviceId] ?? { ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } };
}

export function setProofUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } };
    proofStore.set({ ...instances, [deviceId]: { ...state, uiLevel: level } });
}

export function updateProofPatch(deviceId: string, patch: Partial<ProofPatch>): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } };
    proofStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, ...patch } } });
}

export function loadProofPatch(deviceId: string, patch: ProofPatch): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } };
    proofStore.set({ ...instances, [deviceId]: { ...state, patch } });
}

export function updateProofMeters(deviceId: string, meters: ProofMeterData): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } };
    proofStore.set({
        ...instances,
        [deviceId]: {
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
        },
    });
}
