import { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

export function insertTime(atBeat: number, durationBeats: number): ReturnType<typeof executeGlobalTimeOperation> {
    return executeGlobalTimeOperation({
        operation: {
            type: 'insert',
            atBeat,
            durationBeats,
        },
    });
}
