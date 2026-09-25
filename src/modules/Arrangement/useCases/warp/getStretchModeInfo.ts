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
 * These ids persist with the clip's warp state on the `warpStates` CRDT slot
 * and in the project file; renaming a mode is a wire-format change and needs
 * a migration.
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
