import { type WarpState } from '../../models/WarpMarker';

/** Canonical, ordered list of the warp stretch modes the surface knows about. */
export const STRETCH_MODES: readonly WarpState['stretchMode'][] = ['repitch', 'complex', 'texture', 'beats'];

/**
 * Honest metadata for a warp stretch mode.
 *
 * `available` reflects whether an executor for this mode actually runs today.
 * Only `repitch` — the playback-rate resample — has one. `complex`, `texture`
 * and `beats` name spectral, grain and transient-preserving behaviours that no
 * code in the product performs, so they report `available: false` and the
 * editors do not offer them. No quality, CPU or transient capability is claimed
 * for a mode that does not run.
 *
 * These ids are in-memory only: warp state lives in the `warpStates` Map and is
 * never written to the CRDT document or the .sdaw file, so they are not a wire
 * format and carry no migration obligation.
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
        complex: {
            name: 'Complex',
            available: false,
            description: 'Spectral stretch for mixed material. No executor exists yet.',
        },
        texture: {
            name: 'Texture',
            available: false,
            description: 'Grain-based stretch for pads and ambience. No executor exists yet.',
        },
        beats: {
            name: 'Beats',
            available: false,
            description: 'Transient-preserving stretch for rhythmic material. No executor exists yet.',
        },
    };

    return info[mode];
}
