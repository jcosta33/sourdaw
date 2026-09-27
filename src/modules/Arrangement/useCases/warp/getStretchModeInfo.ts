import { type WarpState } from '../../models/WarpMarker';

/**
 * Canonical, ordered list of the warp stretch modes the surface knows about
 * (ADR 0024 — the three executors, named by material).
 */
export const STRETCH_MODES: readonly WarpState['stretchMode'][] = ['repitch', 'phase-vocoder', 'wsola'];

/**
 * Honest metadata for a warp stretch mode.
 *
 * `available` reflects whether an executor for this mode actually runs today.
 * Only `repitch` — the playback-rate resample — has one. `phase-vocoder` and
 * `wsola` are reserved for the in-house streaming engine, so no code in the
 * product performs them yet; they report `available: false` and the editors
 * do not offer them. No quality, CPU or transient capability is claimed for a
 * mode that does not run.
 *
 * These ids persist with the clip's warp state on the `warpStates` CRDT slot
 * and in the project file. Projects written before ADR 0024 still carry the
 * pre-decision ids (`beats`, `complex`, `texture`); those map onto this set
 * where the state is read — see `decodeStretchMode` in
 * `Arrangement/models/WarpMarker`.
 */
export function getStretchModeInfo(mode: WarpState['stretchMode']): {
    name: string;
    available: boolean;
    description: string;
} {
    const info: Record<
        WarpState['stretchMode'],
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
            name: 'Phase-vocoder',
            available: false,
            description: 'Spectral stretch for harmonic material. No executor exists yet.',
        },
        wsola: {
            name: 'WSOLA',
            available: false,
            description: 'Transient-preserving stretch for rhythmic material. No executor exists yet.',
        },
    };

    return info[mode];
}
