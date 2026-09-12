import { desktopInvoke } from '#/utils/desktopBridge';

import { parseAgentAssetSagaReceipt } from './parseAgentAssetSagaReceipt';

import type { AgentAssetSagaReceipt, AgentWorkOwner } from './agentAssetSagaWire';

const COMMAND = 'agent_asset_cleanup';

/**
 * Drop staged bytes: one saga's, or — with a null saga id — every orphan left behind.
 *
 * The sweep is what makes an abandoned run recoverable rather than permanent: staged files whose
 * saga no longer exists are bytes nothing can finalize.
 */
export async function cleanupAgentAssetSaga(
    sagaId: string | null,
    owner: AgentWorkOwner
): Promise<AgentAssetSagaReceipt> {
    return parseAgentAssetSagaReceipt(COMMAND, await desktopInvoke(COMMAND, { sagaId, owner }));
}
