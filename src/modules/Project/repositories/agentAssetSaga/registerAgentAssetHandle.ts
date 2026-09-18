import { desktopInvoke } from '#/utils/desktopBridge';

import { parseAgentAssetSagaReceipt } from './parseAgentAssetSagaReceipt';

import type { AgentAssetSagaReceipt, AgentWorkOwner, AssetHandleMode } from './agentAssetSagaWire';

const COMMAND = 'agent_asset_register_handle';

/**
 * Mint an opaque handle for one path a file grant already admits.
 *
 * The only export in this folder that takes a path, and the native side admits one here only when
 * a grant the user made in a dialog already covers it. Every other command takes a handle or saga
 * id, so an agent's reach is the set of files the user picked rather than any name it can spell —
 * a second path-taking export here would hand that reach back.
 */
export async function registerAgentAssetHandle(
    path: string,
    mode: AssetHandleMode,
    owner: AgentWorkOwner
): Promise<AgentAssetSagaReceipt> {
    return parseAgentAssetSagaReceipt(COMMAND, await desktopInvoke(COMMAND, { path, mode, owner }));
}
