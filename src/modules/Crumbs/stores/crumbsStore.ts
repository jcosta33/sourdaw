/**
 * Unified Crumbs state store.
 * Holds sample metadata, mode, envelope, filter, and playback state.
 * Reactive — UI subscribes via useStore from #/infra/store/useStore.
 */

import { createStore } from '#/infra/store/createStore';

import {
    CRUMBS_PARAM_TARGETS,
    CRUMBS_PERSISTED_PARAM_IDS,
    type CrumbsPersistedParamId,
} from '../models/CrumbsParameterMap';

import type {
    EnvelopeParams,
    FilterType,
    LoopMode,
    ModXYState,
    SampleMeta,
    CrumbsMode,
    VoiceStackParams,
} from '../models/CrumbsTypes';

export type CrumbsState = {
    mode: CrumbsMode;
    activeSample: SampleMeta | null;
    waveformPeaks: number[];
    envelope: EnvelopeParams;
    filterCutoff: number;
    filterResonance: number;
    filterType: FilterType;
    loopMode: LoopMode;
    loopStart: number;
    loopEnd: number;
    masterGain: number;
    rootNote: number;
    tune: number;
    pan: number;
    isLoading: boolean;
    activeVoices: number;
    peakLeft: number;
    peakRight: number;
    voiceStack: VoiceStackParams;
    modXY: ModXYState;
};

export const defaultCrumbsState: CrumbsState = {
    mode: 'quick',
    activeSample: null,
    waveformPeaks: [],
    envelope: {
        attack: 0.001,
        hold: 0,
        decay: 0.3,
        sustain: 1.0,
        release: 0.1,
    },
    filterCutoff: 20000,
    filterResonance: 1,
    filterType: 'lowpass',
    loopMode: 'off',
    loopStart: 0,
    loopEnd: 1,
    masterGain: 0.8,
    rootNote: 60,
    tune: 0,
    pan: 0,
    isLoading: false,
    activeVoices: 0,
    peakLeft: 0,
    peakRight: 0,
    voiceStack: { stackCount: 1, detuneSpread: 0, stackSpread: 0 },
    modXY: { deckASample: null, deckBSample: null, crossfade: 0 },
};

export const crumbsStore = createStore<Record<string, CrumbsState>>({
    initialData: {},
});

const activeParamPreviews = new Map<string, Set<CrumbsPersistedParamId>>();

export function beginCrumbsParamPreview(instanceId: string, paramId: CrumbsPersistedParamId): void {
    const active = activeParamPreviews.get(instanceId) ?? new Set<CrumbsPersistedParamId>();
    active.add(paramId);
    activeParamPreviews.set(instanceId, active);
}

export function endCrumbsParamPreview(instanceId: string, paramId: CrumbsPersistedParamId): void {
    const active = activeParamPreviews.get(instanceId);
    active?.delete(paramId);
    if (active?.size === 0) {
        activeParamPreviews.delete(instanceId);
    }
}

export function ensureInstance(instanceId: string): void {
    crumbsStore.update((s) => {
        if (!s) {
            return {};
        }
        if (s[instanceId]) {
            return s;
        }
        return { ...s, [instanceId]: { ...defaultCrumbsState } };
    });
}

export function setMode(instanceId: string, mode: CrumbsMode): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], mode },
        };
    });
}

export function setActiveSample(instanceId: string, sample: SampleMeta): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: {
                ...s[instanceId],
                activeSample: sample,
                rootNote: sample.detectedRoot ?? 60,
                isLoading: false,
            },
        };
    });
}

export function setWaveformPeaks(instanceId: string, peaks: number[]): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], waveformPeaks: peaks },
        };
    });
}

export function updateEnvelope(instanceId: string, updates: Partial<EnvelopeParams>): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: {
                ...s[instanceId],
                envelope: { ...s[instanceId].envelope, ...updates },
            },
        };
    });
}

export function setFilterParams(instanceId: string, cutoff?: number, resonance?: number, type?: FilterType): void {
    crumbsStore.update((s) => {
        if (!s) {
            return s;
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        return {
            ...s,
            [instanceId]: {
                ...inst,
                filterCutoff: cutoff ?? inst.filterCutoff,
                filterResonance: resonance ?? inst.filterResonance,
                filterType: type ?? inst.filterType,
            },
        };
    });
}

export function setLoopParams(instanceId: string, mode?: LoopMode, start?: number, end?: number): void {
    crumbsStore.update((s) => {
        if (!s) {
            return s;
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        return {
            ...s,
            [instanceId]: {
                ...inst,
                loopMode: mode ?? inst.loopMode,
                loopStart: start ?? inst.loopStart,
                loopEnd: end ?? inst.loopEnd,
            },
        };
    });
}

/**
 * Valid master-gain range for the Crumbs engine. The Rust `set_param`
 * (`crates/daw-dsp/src/crumbs/engine.rs`) does `master_gain.set(value)` with no
 * clamp, so an out-of-range value would reach the engine unbounded. Bound it here
 * at the single source of truth so every caller — not just the UI Knob — is safe.
 */
const MASTER_GAIN_MIN = 0;
const MASTER_GAIN_MAX = 2;

export function setMasterGain(instanceId: string, gain: number): void {
    const clamped = Math.min(Math.max(gain, MASTER_GAIN_MIN), MASTER_GAIN_MAX);
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], masterGain: clamped },
        };
    });
}

export function setTune(instanceId: string, tune: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], tune },
        };
    });
}

export function setPan(instanceId: string, pan: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], pan },
        };
    });
}

export function setLoading(instanceId: string, isLoading: boolean): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], isLoading },
        };
    });
}

export function setMetering(instanceId: string, peakLeft: number, peakRight: number, activeVoices: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...s[instanceId], peakLeft, peakRight, activeVoices },
        };
    });
}

export function setVoiceStack(instanceId: string, updates: Partial<VoiceStackParams>): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {
            return s;
        }
        return {
            ...s,
            [instanceId]: {
                ...s[instanceId],
                voiceStack: { ...s[instanceId].voiceStack, ...updates },
            },
        };
    });
}

/**
 * Write one persisted knob parameter onto a device's session state.
 *
 * The single store-side entry point for the ten parameters that ride
 * `Device.parameterValues`, addressed by their descriptor id rather than by a
 * per-knob setter. The per-knob setters above stay for the callers that already
 * use them; this one exists because the write path and the read-back path have to
 * resolve a parameter id to a field the *same* way, and two hand-written switch
 * statements are two chances to disagree.
 *
 * No clamping here. `setDeviceParameter` clamps against the declared range on the
 * commit path, and the transient path is previewing a value the knob already
 * bounded to that same range; clamping again against a second, hand-copied bound
 * is how `setMasterGain`'s 0..2 came to disagree with the descriptor's 0..1.
 */
export function applyCrumbsParamValue(instanceId: string, paramId: CrumbsPersistedParamId, value: number): void {
    const target = CRUMBS_PARAM_TARGETS[paramId];
    crumbsStore.update((s) => {
        if (!s) {
            return s;
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        if (target.kind === 'envelope') {
            return {
                ...s,
                [instanceId]: { ...inst, envelope: { ...inst.envelope, [target.key]: value } },
            };
        }
        if (target.kind === 'voiceStack') {
            return {
                ...s,
                [instanceId]: { ...inst, voiceStack: { ...inst.voiceStack, [target.key]: value } },
            };
        }
        return {
            ...s,
            [instanceId]: { ...inst, [target.key]: value },
        };
    });
}

export function replaceCrumbsProjectParameters(
    instanceId: string,
    parameterValues: Readonly<Record<string, unknown>>
): void {
    crumbsStore.update((instances) => {
        const current = instances?.[instanceId];
        if (!instances || !current) {
            return instances;
        }

        let next = current;
        for (const paramId of CRUMBS_PERSISTED_PARAM_IDS) {
            if (activeParamPreviews.get(instanceId)?.has(paramId)) {
                continue;
            }
            const target = CRUMBS_PARAM_TARGETS[paramId];
            const raw = parameterValues[paramId];
            let value: number;
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                value = raw;
            } else if (target.kind === 'envelope') {
                value = defaultCrumbsState.envelope[target.key];
            } else if (target.kind === 'voiceStack') {
                value = defaultCrumbsState.voiceStack[target.key];
            } else {
                value = defaultCrumbsState[target.key];
            }

            if (target.kind === 'envelope') {
                next = { ...next, envelope: { ...next.envelope, [target.key]: value } };
            } else if (target.kind === 'voiceStack') {
                next = { ...next, voiceStack: { ...next.voiceStack, [target.key]: value } };
            } else {
                next = { ...next, [target.key]: value };
            }
        }

        return { ...instances, [instanceId]: next };
    });
}

export function removeInstance(instanceId: string): void {
    activeParamPreviews.delete(instanceId);
    crumbsStore.update((s) => {
        if (!s) {
            return {};
        }
        const next = { ...s };
        delete next[instanceId];
        return next;
    });
}
