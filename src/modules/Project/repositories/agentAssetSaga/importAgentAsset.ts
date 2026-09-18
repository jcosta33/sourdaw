import { desktopInvoke } from '#/utils/desktopBridge';

import { parseAgentAssetSagaReceipt } from './parseAgentAssetSagaReceipt';

import type { AgentAssetDeclaredMetadata, AgentAssetSagaReceipt, AgentWorkOwner } from './agentAssetSagaWire';

const COMMAND = 'agent_asset_import';

/**
 * Read a granted file once, content-address it, and register what its bytes are.
 *
 * Anything declared is checked against what the bytes derive to; a disagreement refuses the import
 * rather than registering the caller's version of the asset.
 */
export async function importAgentAsset(
    handleId: string,
    owner: AgentWorkOwner,
    declared: AgentAssetDeclaredMetadata
): Promise<AgentAssetSagaReceipt> {
    return parseAgentAssetSagaReceipt(COMMAND, await desktopInvoke(COMMAND, { handleId, owner, declared }));
}
