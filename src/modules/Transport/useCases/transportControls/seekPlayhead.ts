import { logger } from '#/infra/logger/appLogger';

import { executePlayheadSeek } from './executePlayheadSeek';

export function seekPlayhead(beat: number): Promise<boolean> {
    return executePlayheadSeek(beat).catch((error: unknown) => {
        logger.error(new Error('Playhead seek failed', { cause: error }));
        return false;
    });
}
