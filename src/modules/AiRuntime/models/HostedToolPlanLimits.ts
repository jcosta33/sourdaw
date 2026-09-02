/**
 * Single source of truth for the hosted tool-planning output budget. Multi-action DAW
 * plans (several tool calls per turn) can outgrow a couple thousand tokens; 8192 stays
 * well under every current hosted model's documented output ceiling (up to 128K on
 * claude-sonnet-5, the catalog default) while giving the planner enough room that a
 * legitimate plan is never cut mid-call.
 *
 * Both the compiled provider request that admits a tool-planning attempt
 * (`llmOrchestration/inference.ts`) and the wire request that actually executes it
 * (`generateAnthropicToolCalls.ts`, reached through `generateCloudToolCalls`) must derive
 * `max_tokens` from this constant. Two independently declared numbers can only stay equal
 * by coincidence — the admission ceiling and the request that runs would otherwise be free
 * to drift apart.
 */
export const TOOL_PLAN_MAX_OUTPUT_TOKENS = 8192;
