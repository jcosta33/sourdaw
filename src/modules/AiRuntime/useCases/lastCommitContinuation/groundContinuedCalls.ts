import { createPunchRegionPatch } from '#/modules/Transport/useCases';

import { denied } from '../../models/LastCommitRefusal';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../../models/LlmActionLimits';
import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeLlmToolCalls } from '../../transformers/llmActionBridge';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { type ContinuedFigure, type LastCommitContinuation } from './lastCommitOutcome';

/** The continued calls compiled through the action bridge as one batch, with the figures they continue. */
export function groundContinuedCalls(
    calls: readonly ToolCallResult[],
    context: ProjectContext,
    continuedFigures: ContinuedFigure[] = []
): LastCommitContinuation {
    if (calls.length > MAX_LLM_ACTIONS_PER_BATCH) {
        return denied(
            `Repeating the last committed change there takes ${String(calls.length)} commands, more than one batch of ${String(MAX_LLM_ACTIONS_PER_BATCH)} holds.`
        );
    }
    const converted = bridgeLlmToolCalls({ calls, context, projectPunchRegion: createPunchRegionPatch });
    const [rejection] = converted.rejections;
    if (rejection !== undefined) {
        return denied(`The continued ${rejection.name} could not be compiled: ${rejection.reason}.`);
    }
    const outcome: Extract<LastCommitContinuation, { status: 'actions' }> = {
        status: 'actions',
        actions: converted.actions,
    };
    if (continuedFigures.length > 0) {
        outcome.continuedFigures = continuedFigures;
    }
    return outcome;
}
