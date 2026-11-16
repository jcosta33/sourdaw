import { type compileAgentActionExecution } from '../compileAgentActionExecution';
import { metricGoalStateCodec } from '../metricGoalStateCodec';

const ADOPTED_ORIGINS: ReadonlySet<string> = new Set(['answer-suggestion', 'last-commit-recipe']);

/**
 * The goal state of a proposal whose adopted recipes promise something perceptual, or null when it
 * holds none. Synchronous so a proposal with nothing to measure reaches its card without an await.
 */
export function readAdoptedRecipeMetricState(
    compiled: Pick<ReturnType<typeof compileAgentActionExecution>, 'metricGoalState'>
): NonNullable<ReturnType<typeof metricGoalStateCodec>> | null {
    const state = metricGoalStateCodec(compiled.metricGoalState);
    if (
        state === null ||
        !state.authorities.some((authority) => ADOPTED_ORIGINS.has(authority.origin) && authority.kind === 'perceptual')
    ) {
        return null;
    }
    return state;
}
