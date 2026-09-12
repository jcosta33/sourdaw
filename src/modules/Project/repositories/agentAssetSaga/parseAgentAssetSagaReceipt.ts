import { isAgentAssetSagaReceipt } from './agentAssetSagaWire';

import type { AgentAssetSagaReceipt } from './agentAssetSagaWire';

/**
 * Narrow one command's answer, or refuse it by name.
 *
 * Every command in this folder answers with the same receipt shape, so the refusal lives here
 * rather than five times over. Naming the command in the message is what makes a contract drift
 * point at the body that drifted.
 */
export function parseAgentAssetSagaReceipt(command: string, payload: unknown): AgentAssetSagaReceipt {
    if (!isAgentAssetSagaReceipt(payload)) {
        throw new TypeError(`${command} returned an invalid saga receipt`);
    }
    return payload;
}
