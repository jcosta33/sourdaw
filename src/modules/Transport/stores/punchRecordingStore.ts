/**
 * Punch recording store — manages continuous background capture state.
 *
 * Extracted from punchRecordingUseCases.ts — stores should live in stores/,
 * not inside use case files.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type PunchRegion = {
    id: string;
    trackId: string;
    /** Beat position where punch-in occurs */
    punchInBeat: number;
    /** Beat position where punch-out occurs */
    punchOutBeat: number;
    /** The source recording clip ID (full background capture) */
    sourceClipId: string;
    /** Pre-roll captured before punch-in (in beats) */
    preRollBeats: number;
    /** Post-roll captured after punch-out (in beats) */
    postRollBeats: number;
    /** Has this punch been committed? */
    committed: boolean;
    /** Crossfade duration at boundaries (beats) */
    crossfadeBeats: number;
};

export type BackgroundCapture = {
    id: string;
    trackId: string;
    /** Start beat of the background recording */
    startBeat: number;
    /** Current end beat (grows as recording continues) */
    endBeat: number;
    /** Is this capture currently recording? */
    recording: boolean;
    /** Associated punch regions carved from this capture */
    punchRegions: PunchRegion[];
};

export type PunchRecordingState = {
    /** Active background captures per track */
    captures: BackgroundCapture[];
    /** Default pre-roll duration in beats */
    defaultPreRoll: number;
    /** Default post-roll duration in beats */
    defaultPostRoll: number;
    /** Default crossfade duration in beats */
    defaultCrossfade: number;
    /** Is continuous background capture enabled? */
    enabled: boolean;
};

export const punchRecordingStore = new Store<PunchRecordingState>(logger, {
    initialData: {
        captures: [],
        defaultPreRoll: 4,
        defaultPostRoll: 2,
        defaultCrossfade: 0.25,
        enabled: false,
    },
});
