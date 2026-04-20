/**
 * Audio warp store — manages time-stretching and pitch-shifting state.
 *
 * Extracted from audioWarpingUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';

export type WarpAlgorithm =
    | 'elastique-pro' // zplane élastique Pro — best overall quality
    | 'elastique-efficient' // zplane élastique Efficient — lower CPU
    | 'elastique-soloist' // zplane élastique Soloist — monophonic optimization
    | 'rubber-band-r3' // Rubber Band R3 engine (finer, offline)
    | 'rubber-band-rt' // Rubber Band real-time engine
    | 'complex' // Ableton-style complex mode
    | 'complex-pro' // Ableton-style complex pro (formant preserve)
    | 'repitch' // Simple resampling (changes pitch)
    | 'slice'; // Beat-slice transient preservation

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

export const audioWarpStore = createStore<WarpState>({
    initialData: {
        clipSettings: new Map(),
        defaultAlgorithm: 'complex-pro',
        globalPitchShift: 0,
    },
});

export function getNextWarpMarkerId(): string {
    return `wm-${crypto.randomUUID()}`;
}

export const DEFAULT_WARP_SETTINGS: ClipWarpSettings = {
    algorithm: 'complex-pro',
    stretchRatio: 1.0,
    pitchShiftSemitones: 0,
    formantPreservation: 1.0,
    transientSensitivity: 0.5,
    markers: [],
    enabled: false,
};
