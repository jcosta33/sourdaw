import { logger } from '#/infra/logger/appLogger';

import { executePlayheadSeek } from './executePlayheadSeek';

export function seekPlayhead(beat: number): void {
    void executePlayheadSeek(beat).catch((error: unknown) => {
        logger.error(new Error('Playhead seek failed', { cause: error }));
    });
}
