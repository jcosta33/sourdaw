import { desktopInvoke } from '#/utils/desktopBridge';

import { parseAgentAssetSagaReceipt } from './parseAgentAssetSagaReceipt';

import type { AgentAssetExportAuthorization, AgentAssetSagaReceipt, AgentWorkOwner } from './agentAssetSagaWire';

const COMMAND = 'agent_asset_finalize_export';

/**
 * Replace the destination with the staged bytes, once, under explicit authorization.
 *
 * Only one finalize per saga can commit; a later one answers `refused` with the lease that took it,
 * so a retry after a crash cannot replace the file twice.
 */
export async function finalizeAgentAssetExport(
    sagaId: string,
    owner: AgentWorkOwner,
    authorization: AgentAssetExportAuthorization
): Promise<AgentAssetSagaReceipt> {
    return parseAgentAssetSagaReceipt(COMMAND, await desktopInvoke(COMMAND, { sagaId, owner, authorization }));
}
