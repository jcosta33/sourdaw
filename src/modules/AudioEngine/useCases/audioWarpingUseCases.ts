/**
 * Audio Warping Algorithms
 *
 * Time-stretching and pitch-shifting using multiple algorithm modes.
 * Rubber Band v4-style and zplane-style stretch modes.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type WarpAlgorithm =
    | 'elastique-pro'       // zplane élastique Pro — best overall quality
    | 'elastique-efficient'  // zplane élastique Efficient — lower CPU
    | 'elastique-soloist'   // zplane élastique Soloist — monophonic optimization
    | 'rubber-band-r3'      // Rubber Band R3 engine (finer, offline)
    | 'rubber-band-rt'      // Rubber Band real-time engine
    | 'complex'             // Ableton-style complex mode
    | 'complex-pro'         // Ableton-style complex pro (formant preserve)
    | 'repitch'             // Simple resampling (changes pitch)
    | 'slice';              // Beat-slice transient preservation

export type WarpMarker = {
    id: string;
    /** Position in the source audio (seconds) */
    sourceSec: number;
    /** Target position in the warped output (beats) */
    targetBeat: number;
    /** Is this marker locked? */
    locked: boolean;
};

export type WarpState = {
    /** Warp settings per clip ID */
    clipSettings: Map<string, ClipWarpSettings>;
    /** Default algorithm for new clips */
    defaultAlgorithm: WarpAlgorithm;
    /** Global pitch shift in semitones (for preview) */
    globalPitchShift: number;
};

export type ClipWarpSettings = {
    algorithm: WarpAlgorithm;
    /** Time stretch ratio (1.0 = original speed) */
    stretchRatio: number;
    /** Pitch shift in semitones (-24 to +24) */
    pitchShiftSemitones: number;
    /** Formant preservation amount (0 = none, 1 = full) */
    formantPreservation: number;
    /** Transient sensitivity (for slice/complex modes, 0-1) */
    transientSensitivity: number;
    /** Warp markers for free-form warping */
    markers: WarpMarker[];
    /** Whether warping is enabled for this clip */
    enabled: boolean;
};

export const audioWarpStore = new Store<WarpState>(logger, {
    initialData: {
        clipSettings: new Map(),
        defaultAlgorithm: 'complex-pro',
        globalPitchShift: 0,
    },
});

let warpMarkerId = 1;

const DEFAULT_SETTINGS: ClipWarpSettings = {
    algorithm: 'complex-pro',
    stretchRatio: 1.0,
    pitchShiftSemitones: 0,
    formantPreservation: 1.0,
    transientSensitivity: 0.5,
    markers: [],
    enabled: false,
};

// ── Per-Clip Settings ─────────────────────────────────────────────────

export function enableWarping(clipId: string): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_SETTINGS, algorithm: state.defaultAlgorithm };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, enabled: true });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function disableWarping(clipId: string): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId);
    if (!settings) {
        return;
    }
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, enabled: false });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function setWarpAlgorithm(clipId: string, algorithm: WarpAlgorithm): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, algorithm });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function setStretchRatio(clipId: string, ratio: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, stretchRatio: Math.max(0.1, Math.min(10, ratio)) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function setPitchShift(clipId: string, semitones: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, pitchShiftSemitones: Math.max(-24, Math.min(24, semitones)) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function setFormantPreservation(clipId: string, amount: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, formantPreservation: Math.max(0, Math.min(1, amount)) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

// ── Warp Markers ──────────────────────────────────────────────────────

export function addWarpMarker(clipId: string, sourceSec: number, targetBeat: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_SETTINGS };
    const marker: WarpMarker = {
        id: `wm-${warpMarkerId++}`,
        sourceSec, targetBeat, locked: false,
    };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, {
        ...settings,
        markers: [...settings.markers, marker].sort((a, b) => a.sourceSec - b.sourceSec),
    });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function removeWarpMarker(clipId: string, markerId: string): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId);
    if (!settings) {
        return;
    }
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, markers: settings.markers.filter((m) => m.id !== markerId) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

export function moveWarpMarker(clipId: string, markerId: string, targetBeat: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId);
    if (!settings) {
        return;
    }
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, {
        ...settings,
        markers: settings.markers.map((m) =>
            m.id === markerId && !m.locked ? { ...m, targetBeat } : m
        ),
    });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}

// ── Processing ────────────────────────────────────────────────────────

/**
 * Calculate effective playback rate between two warp markers.
 */
export function getStretchRateBetweenMarkers(
    markerA: WarpMarker,
    markerB: WarpMarker,
    bpm: number
): number {
    const sourceDuration = markerB.sourceSec - markerA.sourceSec;
    const targetDurationBeats = markerB.targetBeat - markerA.targetBeat;
    const targetDurationSec = (targetDurationBeats / bpm) * 60;

    if (sourceDuration <= 0 || targetDurationSec <= 0) {
        return 1;
    }

    return sourceDuration / targetDurationSec;
}

/**
 * Get the algorithm quality characteristics.
 */
export function getAlgorithmInfo(algorithm: WarpAlgorithm): {
    name: string;
    quality: 'high' | 'medium' | 'low';
    cpuCost: 'high' | 'medium' | 'low';
    bestFor: string;
    realTime: boolean;
} {
    const info: Record<WarpAlgorithm, { name: string; quality: 'high' | 'medium' | 'low'; cpuCost: 'high' | 'medium' | 'low'; bestFor: string; realTime: boolean }> = {
        'elastique-pro':        { name: 'élastique Pro',         quality: 'high',   cpuCost: 'high',   bestFor: 'General purpose, mixed content',      realTime: true },
        'elastique-efficient':  { name: 'élastique Efficient',   quality: 'medium', cpuCost: 'low',    bestFor: 'Real-time with many tracks',          realTime: true },
        'elastique-soloist':    { name: 'élastique Soloist',     quality: 'high',   cpuCost: 'medium', bestFor: 'Solo instruments, vocals',             realTime: true },
        'rubber-band-r3':       { name: 'Rubber Band R3',        quality: 'high',   cpuCost: 'high',   bestFor: 'Offline rendering, highest quality',  realTime: false },
        'rubber-band-rt':       { name: 'Rubber Band RT',        quality: 'medium', cpuCost: 'medium', bestFor: 'Real-time stretching',                 realTime: true },
        'complex':              { name: 'Complex',               quality: 'medium', cpuCost: 'medium', bestFor: 'Mixed content, full mixes',            realTime: true },
        'complex-pro':          { name: 'Complex Pro',           quality: 'high',   cpuCost: 'high',   bestFor: 'Full mixes with formant preservation', realTime: true },
        'repitch':              { name: 'Re-Pitch',              quality: 'low',    cpuCost: 'low',    bestFor: 'Simple speed changes, vinyl effect',   realTime: true },
        'slice':                { name: 'Beat Slice',            quality: 'medium', cpuCost: 'low',    bestFor: 'Drums, percussive content',            realTime: true },
    };

    return info[algorithm];
}

export function setDefaultAlgorithm(algorithm: WarpAlgorithm): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    audioWarpStore.set({ ...state, defaultAlgorithm: algorithm });
}
