import { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

type ReplayPlan = NonNullable<Parameters<typeof executeGlobalTimeOperation>[0]['replayPlan']>;

export function insertTime(
    atBeat: number,
    durationBeats: number,
    replayPlan?: ReplayPlan
): ReturnType<typeof executeGlobalTimeOperation> {
    const operation = {
        type: 'insert' as const,
        atBeat,
        durationBeats,
    };
    if (replayPlan) {
        return executeGlobalTimeOperation({ operation, replayPlan });
    }
    return executeGlobalTimeOperation({ operation });
}
