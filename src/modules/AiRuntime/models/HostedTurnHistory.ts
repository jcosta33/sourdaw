import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type HostedLlmProvider } from './HostedLlmProvider';

/** The hosted protocols that can replay their own earlier turns; WebLLM has no wire form. */
export type HostedTurnProvider = HostedLlmProvider;

/**
 * What one completed hosted turn produced, as the provider itself reported it:
 * `assistantItems` are that turn's raw assistant output (Responses: every `output` item,
 * including `reasoning`; Anthropic: every `content` block; chat completions: the assistant
 * message), kept verbatim so the provider that produced them can be handed them back
 * unchanged. They are `null` for a turn the provider left a call unidentified in: its items
 * name identifiers the receipts cannot answer, so the turn is restated from `calls` instead —
 * the same way a turn a different provider answered is restated.
 */
export type HostedProviderTurn = {
    provider: HostedTurnProvider;
    assistantItems: readonly unknown[] | null;
};

/**
 * One tool call of an earlier turn, under the identifier the loop resolved for it — the
 * provider's own when it returned one, the loop's synthesised one otherwise. That is the
 * identifier the call's receipt is correlated by, so a replay can pair the two whether or
 * not the provider named the call.
 */
export type HostedTurnCall = { id: string; name: string; arguments: Record<string, unknown> };

/**
 * One earlier turn of an application-owned tool loop, with the receipts it earned. A record
 * whose `assistantItems` is `null` is replayed by restating its `calls`, whichever provider
 * answers the next turn.
 */
export type HostedTurnRecord = {
    turn: number;
    provider: HostedTurnProvider;
    assistantItems: readonly unknown[] | null;
    calls: readonly HostedTurnCall[];
    receipts: readonly ApplicationToolReceipt[];
};

/** Every earlier turn of one loop, ascending by turn. */
export type HostedTurnHistory = readonly HostedTurnRecord[];
