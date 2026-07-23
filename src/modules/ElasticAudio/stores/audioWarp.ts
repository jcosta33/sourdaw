/**
 * Audio warp store — manages time-stretching and pitch-shifting state.
 *
 * Extracted from audioWarpingUseCases.ts.
 *
 * Naming honesty (SPEC-time-stretch-engine, AC-002): the surface offers exactly
 * the in-house canonical family `repitch | phase-vocoder | wsola`. It never names
 * third-party licensed engines (élastique, Rubber Band, …) the product does not
 * ship or license. Only `repitch` (playback-rate resample) runs today; the two
 * spectral/time-domain modes are reserved for the in-house streaming engine and
 * are reported as unavailable until real executors exist (see getAlgorithmInfo).
 *
 * This store is in-memory only (createStore, memory storage). No warp id is
 * serialized to the CRDT document or the .sdaw file, so these ids are not a wire
 * format and carry no migration obligation.
 */

import { createStore } from '#/infra/store/createStore';

export type WarpAlgorithm =
    | 'repitch' // Resample — pitch follows tempo (the only mode that runs today)
    | 'phase-vocoder' // In-house spectral stretch — reserved, not yet available
    | 'wsola'; // In-house time-domain stretch — reserved, not yet available

/** Canonical, ordered list of warp algorithms the surface knows about. */
export const WARP_ALGORITHMS: readonly WarpAlgorithm[] = ['repitch', 'phase-vocoder', 'wsola'];

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
    /** Formant preservation amount (0 = none, 1 = full) — consumed by the future in-house engine */
    formantPreservation: number;
    /** Transient sensitivity (0-1) — consumed by the future in-house engine */
    transientSensitivity: number;
    /** Whether warping is enabled for this clip */
    enabled: boolean;
};

export const audioWarpStore = createStore<WarpState>({
    initialData: {
        clipSettings: new Map(),
        defaultAlgorithm: 'repitch',
        globalPitchShift: 0,
    },
});

export const DEFAULT_WARP_SETTINGS: ClipWarpSettings = {
    algorithm: 'repitch',
    stretchRatio: 1.0,
    pitchShiftSemitones: 0,
    formantPreservation: 1.0,
    transientSensitivity: 0.5,
    enabled: false,
};
