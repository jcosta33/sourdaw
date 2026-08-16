/**
 * Proof mastering suite store — patch state + real-time metering data.
 * Keyed by deviceId to support multiple simultaneous instances.
 */

import { createStore } from '#/infra/store/createStore';

import { type ProofPatch, DEFAULT_PATCH, cloneProofPatch } from '../models/ProofPatch';

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
    projectPatchHydrated: boolean;
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
    patch: cloneProofPatch(DEFAULT_PATCH),
    projectPatchHydrated: false,
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
 * leak into the shared default and every other fallback. The patch carries the
 * same hazard one level deeper — its band arrays and band objects — so it is
 * cloned rather than spread.
 */
function createDefaultProofState(): ProofState {
    return {
        ...DEFAULT_PROOF_STATE,
        patch: cloneProofPatch(DEFAULT_PATCH),
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
    preservePresetId?: boolean;
};

export function updateProofPatch({ deviceId, patch, preservePresetId }: UpdateProofPatchInput): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
    // A committed granular edit diverges from its source preset. Transient
    // previews retain the identity until their gesture actually commits.
    proofStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: {
                ...state.patch,
                presetId: preservePresetId ? state.patch.presetId : undefined,
                ...patch,
            },
        },
    });
}

type HydrateProofPatchInput = {
    deviceId: string;
    patch: Partial<ProofPatch>;
};

export function hydrateProofPatch({ deviceId, patch }: HydrateProofPatchInput): void {
    const instances = proofStore.value ?? {};
    const state = instances[deviceId] ?? createDefaultProofState();
    proofStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            projectPatchHydrated: true,
            patch: { ...state.patch, ...patch },
        },
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
    // Cloned because the common caller hands over a factory preset's own patch
    // object: storing it directly would make the live device and the immutable
    // factory preset the same bands.
    proofStore.set({
        ...instances,
        [deviceId]: { ...state, patch: cloneProofPatch(patch), projectPatchHydrated: true },
    });
}

function areMetersUnchanged(state: ProofState, meters: ProofMeterData): boolean {
    if (
        state.inputLufs !== meters.inputLufs ||
        state.outputLufs !== meters.outputLufs ||
        state.outputStLufs !== meters.outputStLufs ||
        state.integratedLufs !== meters.integratedLufs ||
        state.truePeakDb !== meters.truePeakDb ||
        state.lra !== meters.lra ||
        state.correlation !== meters.correlation ||
        state.limiterGrDb !== meters.limiterGrDb ||
        state.latency !== meters.latency
    ) {
        return false;
    }

    for (let band = 0; band < state.dynGr.length; band++) {
        if (state.dynGr[band] !== meters.dynGr[band]) {
            return false;
        }
    }

    if (state.tapPeaks.length !== meters.tapPeaks.length) {
        return false;
    }

    for (let tap = 0; tap < state.tapPeaks.length; tap++) {
        if (
            state.tapPeaks[tap]?.peakL !== meters.tapPeaks[tap]?.peakL ||
            state.tapPeaks[tap]?.peakR !== meters.tapPeaks[tap]?.peakR
        ) {
            return false;
        }
    }

    return true;
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
    const existing = instances[deviceId];
    // A frame carrying the same numbers as the last one — silence, or a stopped
    // transport — must not publish new instance and array identities, or every
    // subscriber wakes ~62 times a second to render values it already shows.
    // The comparison reads scalars and allocates nothing, so it stays fit for
    // the RT-fed path. Skipped only when the instance exists: the first frame
    // has to create it.
    if (existing && areMetersUnchanged(existing, meters)) {
        return;
    }
    const state = existing ?? createDefaultProofState();
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
