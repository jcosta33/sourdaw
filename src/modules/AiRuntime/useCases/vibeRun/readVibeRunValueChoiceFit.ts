import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type AgentRunBudgets } from '../../models/AgentRun';
import { type ProjectContext } from '../../models/ProjectContext';
import { type MeasuredScheduledVibeRunPlan } from '../../models/VibeRunPlan';

import {
    buildVibeBatchCorrectionMessage,
    VIBE_BATCH_REFUSED_REPLY_ECHO_MAX_CHARS,
    VIBE_BATCH_REJECTION_REASON_MAX_CHARS,
} from './buildVibeBatchCorrectionMessage';
import { buildVibeBatchValueRequest, type VibeBatchValueRequest } from './buildVibeBatchValueRequest';

/** A first request and its one correction: the most attempts a batch's value choice makes. */
export const VIBE_BATCH_VALUE_ATTEMPTS_PER_BATCH = 2;

/**
 * What the compiled provider request adds around its messages and tools before the estimator
 * counts it: the protocol version, run, request, correlation and cancellation identity, the
 * limits, budget, controls and data-policy fields, and the disclosure evidence it declares.
 */
const COMPILED_REQUEST_ENVELOPE_BYTES = 2_048;

export type VibeRunValueChoiceFit = {
    /** One value request per planned batch. */
    readonly calls: number;
    /** Every batch's request and its correction, at their token ceilings. */
    readonly worstCaseTokens: number;
    readonly refusal: string | null;
};

function utf8Bytes(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}

/**
 * One attempt's ceiling, by the rule the provider attempt admission estimates with: each token
 * consumes at least one UTF-8 byte of the serialized request, plus the reply's output cap.
 */
function attemptCeiling(request: VibeBatchValueRequest, userMessage: string): number {
    const serialized = JSON.stringify({
        messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: userMessage },
        ],
        tools: request.tools.map((tool) => tool.function),
    });
    return utf8Bytes(serialized) + COMPILED_REQUEST_ENVELOPE_BYTES + request.maxOutputTokens;
}

/** The correction at its longest: the whole refused-reply echo and the longest rejection reason. */
function correctionCeiling(request: VibeBatchValueRequest): number {
    const longest = buildVibeBatchCorrectionMessage(request, [], 'x'.repeat(VIBE_BATCH_REJECTION_REASON_MAX_CHARS));
    return attemptCeiling(request, longest) + VIBE_BATCH_REFUSED_REPLY_ECHO_MAX_CHARS;
}

function readRemaining(budgets: AgentRunBudgets, category: string): number {
    const limit = budgets.limits[category] ?? Number.POSITIVE_INFINITY;
    return limit - (budgets.consumed[category] ?? 0);
}

/**
 * Whether the run can afford, at worst, a value request and its correction for every planned batch
 * within what its `hostedTextPlanningTokens` budget has left. It builds each batch's request from the
 * plan exactly as the batch will, so the fit counts the request that will be sent.
 */
export function readVibeRunValueChoiceFit(input: {
    plan: MeasuredScheduledVibeRunPlan;
    catalog: ReturnType<typeof getMixRecipeCatalog>;
    context: Pick<ProjectContext, 'tracks'>;
    budgets: AgentRunBudgets;
}): VibeRunValueChoiceFit {
    let worstCaseTokens = 0;
    for (const batch of input.plan.batches) {
        const built = buildVibeBatchValueRequest({
            batch,
            initial: input.plan.initial,
            catalog: input.catalog,
            context: input.context,
        });
        if (built.status === 'refused') {
            return { calls: input.plan.batches.length, worstCaseTokens, refusal: built.reason };
        }
        worstCaseTokens += attemptCeiling(built.request, built.request.userMessage) + correctionCeiling(built.request);
    }
    const calls = input.plan.batches.length;
    const remaining = readRemaining(input.budgets, 'hostedTextPlanningTokens');
    const refusal =
        worstCaseTokens > remaining
            ? `parameter-value choice for every batch needs up to ${String(worstCaseTokens)} tokens over ${String(calls * VIBE_BATCH_VALUE_ATTEMPTS_PER_BATCH)} provider calls, more than the ${String(remaining)} this run's hostedTextPlanningTokens budget has left`
            : null;
    return { calls, worstCaseTokens, refusal };
}
