/**
 * Unified Crumbs state store.
 * Holds sample metadata, mode, envelope, filter, and playback state.
 * Reactive — UI subscribes via useStore from #/infra/store/useStore.
 */

import { createStore } from '#/infra/store/createStore';
import type {
    EnvelopeParams,
    FilterType,
    LoopMode,
    ModXYState,
    SampleMeta,
    CrumbsMode,
    SliceMarker,
    VoiceStackParams,
} from '../models/CrumbsTypes';

export type CrumbsState = {
    mode: CrumbsMode;
    activeSample: SampleMeta | null;
    waveformPeaks: number[];
    sliceMarkers: SliceMarker[];
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
    sliceMarkers: [],
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

export function ensureInstance(instanceId: string): void {
    crumbsStore.update((s) => {
        if (!s) {return {};}
        if (s[instanceId]) {return s;}
        return { ...s, [instanceId]: { ...defaultCrumbsState } };
    });
}

export function setMode(instanceId: string, mode: CrumbsMode): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, mode },
        };
    });
}

export function setActiveSample(instanceId: string, sample: SampleMeta): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: {
                ...s[instanceId]!,
                activeSample: sample,
                rootNote: sample.detectedRoot ?? 60,
                isLoading: false,
            },
        };
    });
}

export function setWaveformPeaks(instanceId: string, peaks: number[]): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, waveformPeaks: peaks },
        };
    });
}

export function setSliceMarkers(instanceId: string, markers: SliceMarker[]): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, sliceMarkers: markers },
        };
    });
}

export function updateEnvelope(instanceId: string, updates: Partial<EnvelopeParams>): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: {
                ...s[instanceId]!,
                envelope: { ...s[instanceId]!.envelope, ...updates },
            },
        };
    });
}

export function setFilterParams(
    instanceId: string,
    cutoff?: number,
    resonance?: number,
    type?: FilterType
): void {
    crumbsStore.update((s) => {
        if (!s) {return s;}
        const inst = s[instanceId];
        if (!inst) {return s;}
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

export function setLoopParams(
    instanceId: string,
    mode?: LoopMode,
    start?: number,
    end?: number
): void {
    crumbsStore.update((s) => {
        if (!s) {return s;}
        const inst = s[instanceId];
        if (!inst) {return s;}
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

export function setMasterGain(instanceId: string, gain: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, masterGain: gain },
        };
    });
}

export function setRootNote(instanceId: string, note: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, rootNote: note },
        };
    });
}

export function setTune(instanceId: string, tune: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, tune },
        };
    });
}

export function setPan(instanceId: string, pan: number): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, pan },
        };
    });
}

export function setLoading(instanceId: string, isLoading: boolean): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, isLoading },
        };
    });
}

export function setMetering(
    instanceId: string,
    peakLeft: number,
    peakRight: number,
    activeVoices: number
): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: { ...s[instanceId]!, peakLeft, peakRight, activeVoices },
        };
    });
}

export function setVoiceStack(instanceId: string, updates: Partial<VoiceStackParams>): void {
    crumbsStore.update((s) => {
        if (!s || !s[instanceId]) {return s;}
        return {
            ...s,
            [instanceId]: {
                ...s[instanceId]!,
                voiceStack: { ...s[instanceId]!.voiceStack, ...updates },
            },
        };
    });
}

export function removeInstance(instanceId: string): void {
    crumbsStore.update((s) => {
        if (!s) {return {};}
        const next = { ...s };
        delete next[instanceId];
        return next;
    });
}
