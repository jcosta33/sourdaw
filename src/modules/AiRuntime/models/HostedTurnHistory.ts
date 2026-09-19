import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type HostedLlmProvider } from './HostedLlmProvider';

/** The hosted protocols that can replay their own earlier turns; WebLLM has no wire form. */
export type HostedTurnProvider = HostedLlmProvider;

/**
 * What one completed hosted turn produced, as the provider itself reported it:
 * `assistantItems` are that turn's raw assistant output (Responses: every `output` item,
 * including `reasoning`; Anthropic: every `content` block; chat completions: the assistant
 * message), kept verbatim so the provider that produced them can be handed them back
 * unchanged. A later turn on a different provider cannot use them and synthesises tool-call
 * items from `calls` instead.
 */
export type HostedProviderTurn = {
    provider: HostedTurnProvider;
    assistantItems: readonly unknown[];
};

/**
 * One tool call of an earlier turn, under the identifier the loop resolved for it — the
 * provider's own when it returned one, the loop's synthesised one otherwise. That is the
 * identifier the call's receipt is correlated by, so a replay can pair the two whether or
 * not the provider named the call.
 */
export type HostedTurnCall = { id: string; name: string; arguments: Record<string, unknown> };

/** One earlier turn of an application-owned tool loop, with the receipts it earned. */
export type HostedTurnRecord = {
    turn: number;
    provider: HostedTurnProvider;
    assistantItems: readonly unknown[];
    calls: readonly HostedTurnCall[];
    receipts: readonly ApplicationToolReceipt[];
};

/** Every earlier turn of one loop, ascending by turn. */
export type HostedTurnHistory = readonly HostedTurnRecord[];
