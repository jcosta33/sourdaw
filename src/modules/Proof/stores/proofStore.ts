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

/**
 * Build a fresh default state with its own mutable arrays. A shallow spread of
 * `DEFAULT_PROOF_STATE` would alias the singleton's `tapPeaks`/`dynGr` arrays
 * across every fallback caller, so a later in-place write to one instance would
 * leak into the shared default and every other fallback.
 */
function createDefaultProofState(): ProofState {
    return {
        ...DEFAULT_PROOF_STATE,
        patch: { ...DEFAULT_PATCH },
        dynGr: [...DEFAULT_PROOF_STATE.dynGr],
        tapPeaks: DEFAULT_PROOF_STATE.tapPeaks.map((peak) => ({ ...peak })),
    };
}

export function getProofState(deviceId: string): ProofState {
    return proofStore.value?.[deviceId] ?? createDefaultProofState();
}

type SetProofUiLevelInput = {
    deviceId: string;
    level: 1 | 2 | 3 | 4 | 5;
};

export function setProofUiLevel({ deviceId, level }: SetProofUiLevelInput): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
    proofStore.set({ ...instances, [deviceId]: { ...state, uiLevel: level } });
}

type UpdateProofPatchInput = {
    deviceId: string;
    patch: Partial<ProofPatch>;
};

export function updateProofPatch({ deviceId, patch }: UpdateProofPatchInput): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
    // A granular edit diverges the patch from its source preset, so the preset
    // identity is dropped unless the caller explicitly carries a new one.
    proofStore.set({
        ...instances,
        [deviceId]: { ...state, patch: { ...state.patch, presetId: undefined, ...patch } },
    });
}

type SetProofAbBypassInput = {
    deviceId: string;
    abBypass: boolean;
};

/**
 * Toggle the A/B compare flag (dry/wet at the chain head). Runtime state only —
 * deliberately not part of `ProofPatch`, so it is never persisted with a saved
 * patch and resets when a device is re-created.
 */
export function setProofAbBypass({ deviceId, abBypass }: SetProofAbBypassInput): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
    proofStore.set({ ...instances, [deviceId]: { ...state, abBypass } });
}

type LoadProofPatchInput = {
    deviceId: string;
    patch: ProofPatch;
};

export function loadProofPatch({ deviceId, patch }: LoadProofPatchInput): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
    proofStore.set({ ...instances, [deviceId]: { ...state, patch } });
}

/**
 * RT-no-alloc exception (AGENTS.md:203): kept as positional `(deviceId, meters)`
 * rather than a single object param. This is the ~60Hz meter-update sink driven
 * by ProofNode's 16ms SAB poll (ProofNode.ts:137) via wasmDeviceRegistry.ts:535;
 * wrapping the args in a fresh `{ deviceId, meters }` object on every frame would
 * allocate per meter frame on a hot path, which AGENTS.md's RT-no-alloc rule
 * takes precedence over. The `meters` payload is already a single object.
 */
export function updateProofMeters(deviceId: string, meters: ProofMeterData): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
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
