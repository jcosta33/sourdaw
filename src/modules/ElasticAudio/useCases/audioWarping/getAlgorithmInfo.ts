import { type WarpAlgorithm } from '../../stores/audioWarp';

/**
 * Honest, spec-aligned metadata for a warp algorithm.
 *
 * `available` reflects whether an executor for this algorithm actually runs today.
 * Only `repitch` (playback-rate resample) is available; `phase-vocoder` and
 * `wsola` are reserved for the in-house streaming engine (SPEC-time-stretch-engine
 * AC-002) and report `available: false` until real executors exist. No quality,
 * CPU, real-time, or formant capability is claimed for a mode that does not run.
 */
export function getAlgorithmInfo(algorithm: WarpAlgorithm): {
    name: string;
    available: boolean;
    description: string;
} {
    const info: Record<
        WarpAlgorithm,
        {
            name: string;
            available: boolean;
            description: string;
        }
    > = {
        repitch: {
            name: 'Repitch',
            available: true,
            description: 'Resamples the clip — pitch follows tempo. The only stretch mode that runs today.',
        },
        'phase-vocoder': {
            name: 'Phase Vocoder',
            available: false,
            description: 'Pitch-preserving spectral time-stretch. In-house engine not yet available.',
        },
        wsola: {
            name: 'WSOLA',
            available: false,
            description:
                'Pitch-preserving time-domain stretch for transient material. In-house engine not yet available.',
        },
    };

    return info[algorithm];
}
