import { type HostedToolPlanUsage } from '../../../models/HostedToolPlanUsage';
import { type ToolCallResult } from '../../../transformers/toolCallParser';

// Re-exported so every existing adapter import keeps resolving `HostedToolPlanUsage` from
// this path; the type itself lives in `models/` because `errors/ToolPlanningRejectedError.ts`
// carries it too, and only `useCases/` may reach into `repositories/`.
export { type HostedToolPlanUsage };

/**
 * What one hosted tool-planning request returned: the calls it produced, the
 * provider's own identifier for the request that produced them (so a plan can be
 * correlated with the provider-side record regardless of protocol), the turn's raw
 * assistant output exactly as the provider sent it (so a later turn can hand the same
 * items back), whether the request used a strict tool schema, and the provider-reported
 * usage for the request.
 */
export type HostedToolPlan = {
    providerRequestId: string | null;
    calls: ToolCallResult[];
    assistantItems: readonly unknown[];
    strictToolSchemas: boolean;
    usage: HostedToolPlanUsage | null;
};

/**
 * What one hosted tool-planning turn tells the provider about choosing a tool. `auto` leaves
 * the choice — and whether to call more than one tool — to the provider's own default. `required`
 * forces the model to call at least one tool from `toolNames`, so the loop's final allowed turn
 * cannot end in prose. It does not cap the turn at one call: a workflow's terminal shape is two
 * calls in the same turn (`selectWorkflowCapability` beside `command.batch.propose`), and the
 * turn's call count stays bounded by `maxCallsPerTurn` instead.
 */
export type HostedToolChoiceDirective = { mode: 'auto' } | { mode: 'required'; toolNames: readonly string[] };

export const AUTO_TOOL_CHOICE: HostedToolChoiceDirective = { mode: 'auto' };

/**
 * Admits a wire usage figure only as a safe non-negative integer, mirroring
 * `modelProviderProtocol.ts`'s own `isUsageCounter` guard on the pushed usage event.
 * A provider that reports a fractional or negative figure (for example a sampled or
 * averaged `prompt_tokens`) would otherwise throw out of `admitEvent` and destroy an
 * already-admitted tool plan; reading `null` for that field here is the same
 * "no figure reported" outcome the protocol already tolerates.
 */
export function readHostedTokenCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
