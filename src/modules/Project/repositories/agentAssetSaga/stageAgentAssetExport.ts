import { desktopInvoke } from '#/utils/desktopBridge';

import { parseAgentAssetSagaReceipt } from './parseAgentAssetSagaReceipt';

import type { AgentAssetSagaReceipt, AgentWorkOwner } from './agentAssetSagaWire';

const COMMAND = 'agent_asset_stage_export';

/**
 * Stage an export's bytes and verify them, without touching the destination.
 *
 * The payload rides `desktopInvoke`'s trailing-buffer path, so the bytes cross at their own length
 * instead of as a JSON number array, and the receipt still comes back.
 */
export async function stageAgentAssetExport(
    destinationHandleId: string,
    owner: AgentWorkOwner,
    expectedSha256: string,
    data: Uint8Array
): Promise<AgentAssetSagaReceipt> {
    return parseAgentAssetSagaReceipt(
        COMMAND,
        await desktopInvoke(COMMAND, { destinationHandleId, owner, expectedSha256, data })
    );
}
