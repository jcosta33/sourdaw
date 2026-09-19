import { type HostedTurnRecord } from '../../../models/HostedTurnHistory';

export type ReplayableHostedTurnCall = { id: string; name: string; arguments: Record<string, unknown> };

/**
 * The calls of one earlier turn, each carrying the provider identifier its receipt is
 * correlated by. A call the provider never identified cannot be replayed: the receipt that
 * answers it would reference an identifier no assistant item on the wire carries, which every
 * hosted dialect rejects. The loop only records provider-returned identifiers, so this states
 * the contract rather than guarding a path the loop reaches.
 */
export function readHostedTurnCalls(record: HostedTurnRecord): ReplayableHostedTurnCall[] {
    return record.calls.map((call) => {
        if (call.id === undefined || call.id.length === 0) {
            throw new Error(`Hosted turn ${String(record.turn)} carries a tool call with no provider identifier`);
        }
        return { id: call.id, name: call.name, arguments: call.arguments };
    });
}
