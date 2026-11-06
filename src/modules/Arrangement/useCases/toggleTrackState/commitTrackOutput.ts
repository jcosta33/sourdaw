import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';

type TrackOutputChange = {
    trackId: string;
    outputId: string;
    /** The output the caller saw, so a change made elsewhere meanwhile is refused rather than overwritten. */
    expectedOutputId: string;
};

/**
 * Commits one output pick as an undoable `setTrackOutput` action. The handler
 * applies the engine effect only after the commit, so nothing was previewed
 * and a refused or failed commit has no live state to put back.
 */
export async function commitTrackOutput({ trackId, outputId, expectedOutputId }: TrackOutputChange): Promise<void> {
    try {
        await executeAppAction({ type: 'setTrackOutput', payload: { trackId, outputId, expectedOutputId } });
    } catch (error) {
        logger.error(new Error(`Track output commit failed for ${trackId} -> ${outputId}`, { cause: error }));
    }
}
