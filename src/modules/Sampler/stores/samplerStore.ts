/**
 * Unified Sampler state store.
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
    SamplerMode,
    SliceMarker,
    VoiceStackParams,
} from '../models/SamplerTypes';

export type SamplerState = {
    instanceId: string | null;
    mode: SamplerMode;
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

const INITIAL_STATE: SamplerState = {
    instanceId: null,
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

export const samplerStore = createStore<SamplerState>({
    initialData: INITIAL_STATE,
});

export function setInstanceId(instanceId: string): void {
    samplerStore.update((s) => (s ? { ...s, instanceId } : s));
}

export function setMode(mode: SamplerMode): void {
    samplerStore.update((s) => (s ? { ...s, mode } : s));
}

export function setActiveSample(sample: SampleMeta): void {
    samplerStore.update((s) =>
        s
            ? {
                  ...s,
                  activeSample: sample,
                  rootNote: sample.detectedRoot ?? 60,
                  isLoading: false,
              }
            : s
    );
}

export function setWaveformPeaks(peaks: number[]): void {
    samplerStore.update((s) => (s ? { ...s, waveformPeaks: peaks } : s));
}

export function setSliceMarkers(markers: SliceMarker[]): void {
    samplerStore.update((s) => (s ? { ...s, sliceMarkers: markers } : s));
}

export function updateEnvelope(updates: Partial<EnvelopeParams>): void {
    samplerStore.update((s) =>
        s ? { ...s, envelope: { ...s.envelope, ...updates } } : s
    );
}

export function setFilterParams(cutoff?: number, resonance?: number, type?: FilterType): void {
    samplerStore.update((s) => {
        if (!s) return s;
        return {
            ...s,
            filterCutoff: cutoff ?? s.filterCutoff,
            filterResonance: resonance ?? s.filterResonance,
            filterType: type ?? s.filterType,
        };
    });
}

export function setLoopParams(mode?: LoopMode, start?: number, end?: number): void {
    samplerStore.update((s) => {
        if (!s) return s;
        return {
            ...s,
            loopMode: mode ?? s.loopMode,
            loopStart: start ?? s.loopStart,
            loopEnd: end ?? s.loopEnd,
        };
    });
}

export function setMasterGain(gain: number): void {
    samplerStore.update((s) => (s ? { ...s, masterGain: gain } : s));
}

export function setRootNote(note: number): void {
    samplerStore.update((s) => (s ? { ...s, rootNote: note } : s));
}

export function setTune(tune: number): void {
    samplerStore.update((s) => (s ? { ...s, tune } : s));
}

export function setPan(pan: number): void {
    samplerStore.update((s) => (s ? { ...s, pan } : s));
}

export function setLoading(isLoading: boolean): void {
    samplerStore.update((s) => (s ? { ...s, isLoading } : s));
}

export function setMetering(peakLeft: number, peakRight: number, activeVoices: number): void {
    samplerStore.update((s) => (s ? { ...s, peakLeft, peakRight, activeVoices } : s));
}

export function setVoiceStack(updates: Partial<VoiceStackParams>): void {
    samplerStore.update((s) =>
        s ? { ...s, voiceStack: { ...s.voiceStack, ...updates } } : s
    );
}

export function setModXY(updates: Partial<ModXYState>): void {
    samplerStore.update((s) =>
        s ? { ...s, modXY: { ...s.modXY, ...updates } } : s
    );
}
