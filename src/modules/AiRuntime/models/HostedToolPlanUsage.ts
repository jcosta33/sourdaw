/**
 * Token usage a hosted provider reported for one tool-planning request. Each field is
 * `null` when the provider's response carried no figure for it — a cache write, for
 * instance, is Anthropic-only and stays `null` for every other provider.
 *
 * This shape lives in `models/` rather than beside the adapters in `repositories/` because
 * `errors/ToolPlanningRejectedError.ts` carries it too, and only `useCases/` may reach into
 * `repositories/`. `repositories/cloudLlm/cloudInference/hostedToolPlan.ts` re-exports this
 * type so every existing adapter import keeps resolving from that one path.
 */
export type HostedToolPlanUsage = {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheWriteInputTokens: number | null;
};
