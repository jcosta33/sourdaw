import { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

type ReplayPlan = NonNullable<Parameters<typeof executeGlobalTimeOperation>[0]['replayPlan']>;

export function deleteTime(
    startBeat: number,
    endBeat: number,
    replayPlan?: ReplayPlan
): ReturnType<typeof executeGlobalTimeOperation> {
    const operation = {
        type: 'delete' as const,
        startBeat,
        endBeat,
    };
    if (replayPlan) {
        return executeGlobalTimeOperation({ operation, replayPlan });
    }
    return executeGlobalTimeOperation({ operation });
}
