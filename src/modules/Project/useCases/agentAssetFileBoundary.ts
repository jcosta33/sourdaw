import { cleanupAgentAssetSaga } from '../repositories/agentAssetSaga/cleanupAgentAssetSaga';
import { finalizeAgentAssetExport } from '../repositories/agentAssetSaga/finalizeAgentAssetExport';
import { importAgentAsset } from '../repositories/agentAssetSaga/importAgentAsset';
import { registerAgentAssetHandle } from '../repositories/agentAssetSaga/registerAgentAssetHandle';
import { stageAgentAssetExport } from '../repositories/agentAssetSaga/stageAgentAssetExport';
import { openViaNative } from '../repositories/nativeFileDialog/openViaNative';
import { saveViaNative } from '../repositories/nativeFileDialog/saveViaNative';

import { isNativeProjectRuntimeAvailable } from './isNativeProjectRuntimeAvailable';

import type {
    AgentAssetDeclaredMetadata,
    AgentAssetExportAuthorization,
    AgentAssetSagaReceipt,
    AgentWorkOwner,
    AssetHandleMode,
} from '../repositories/agentAssetSaga/agentAssetSagaWire';
import type { OpenFileOptions } from '../repositories/nativeFileDialog/helpers';

type AgentAssetHandleGrant = { handleId: string; receipt: AgentAssetSagaReceipt };

type AgentAssetBoundaryRefusal = {
    status: 'refused';
    reason: 'malformed-handle-id' | 'malformed-saga-id' | 'native-runtime-unavailable' | 'no-selection';
};

type AgentAssetPickResult =
    | { status: 'granted'; handles: AgentAssetHandleGrant[]; failures: AgentAssetSagaReceipt[] }
    | { status: 'refused'; reason: 'registration-failed'; failures: AgentAssetSagaReceipt[] }
    | AgentAssetBoundaryRefusal;

type AgentAssetBoundaryResult = { status: 'receipt'; receipt: AgentAssetSagaReceipt } | AgentAssetBoundaryRefusal;

// Native ids are minted as `asset-handle-<uuid v4>` / `asset-saga-<uuid v4>`; the native side
// rejects anything else with an Err. Matching that shape here means a caller-supplied string that
// could be a filesystem path — one containing `/`, `\`, `:`, or `..` among other things — never
// reaches the bridge, because it can never match a v4 UUID suffix.
const HANDLE_ID_PATTERN = /^asset-handle-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAGA_ID_PATTERN = /^asset-saga-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMalformedHandleId(handleId: string): boolean {
    return !HANDLE_ID_PATTERN.test(handleId);
}

function isMalformedSagaId(sagaId: string): boolean {
    return !SAGA_ID_PATTERN.test(sagaId);
}

/**
 * Select paths for one `pickAndRegister` call. `'read'` opens the open dialog, which the desktop
 * shell grants `{ mode: 'read' }`; `'read-write'` opens the save dialog instead, because the open
 * channel can never grant write access. A save-dialog destination is wrapped into a one-element
 * array so both routes answer the same shape.
 */
async function selectPathsForMode(input: {
    mode: AssetHandleMode;
    multiple?: boolean;
    filters?: OpenFileOptions['filters'];
    suggestedName?: string;
}): Promise<string[] | null> {
    if (input.mode === 'read-write') {
        const destination = await saveViaNative({ filters: input.filters, suggestedName: input.suggestedName });
        return destination === null ? null : [destination];
    }
    return openViaNative({ multiple: input.multiple ?? false, filters: input.filters });
}

/**
 * Let the user pick files through the native dialog and mint an opaque handle for each one.
 *
 * `'read'` mints through the open dialog; `'read-write'` mints through the save dialog, since only
 * the save channel grants write access. `suggestedName` is reduced to a file name (`saveViaNative`)
 * before it reaches the shell.
 *
 * Paths never leave `openViaNative`/`saveViaNative` and `registerAgentAssetHandle`: this function
 * receives them only to forward them to the mint call, and neither the return value nor any thrown
 * error carries one. A caller that needs to know what happened to a specific selection reads
 * `receipt.state` and `receipt.failure` on that entry, not a path.
 */
async function pickAndRegister(input: {
    owner: AgentWorkOwner;
    mode: AssetHandleMode;
    multiple?: boolean;
    filters?: OpenFileOptions['filters'];
    suggestedName?: string;
}): Promise<AgentAssetPickResult> {
    if (!isNativeProjectRuntimeAvailable()) {
        return { status: 'refused', reason: 'native-runtime-unavailable' };
    }

    const selectedPaths = await selectPathsForMode(input);
    if (!selectedPaths || selectedPaths.length === 0) {
        return { status: 'refused', reason: 'no-selection' };
    }

    const handles: AgentAssetHandleGrant[] = [];
    const failures: AgentAssetSagaReceipt[] = [];
    for (const path of selectedPaths) {
        const receipt = await registerAgentAssetHandle(path, input.mode, input.owner);
        if (receipt.handleId === null) {
            failures.push(receipt);
        } else {
            handles.push({ handleId: receipt.handleId, receipt });
        }
    }

    if (handles.length === 0) {
        return { status: 'refused', reason: 'registration-failed', failures };
    }
    return { status: 'granted', handles, failures };
}

async function importAsset(input: {
    handleId: string;
    owner: AgentWorkOwner;
    declared?: AgentAssetDeclaredMetadata;
}): Promise<AgentAssetBoundaryResult> {
    if (isMalformedHandleId(input.handleId)) {
        return { status: 'refused', reason: 'malformed-handle-id' };
    }

    return { status: 'receipt', receipt: await importAgentAsset(input.handleId, input.owner, input.declared ?? {}) };
}

async function stageExport(input: {
    destinationHandleId: string;
    owner: AgentWorkOwner;
    expectedSha256: string;
    data: Uint8Array;
}): Promise<AgentAssetBoundaryResult> {
    if (isMalformedHandleId(input.destinationHandleId)) {
        return { status: 'refused', reason: 'malformed-handle-id' };
    }

    return {
        status: 'receipt',
        receipt: await stageAgentAssetExport(input.destinationHandleId, input.owner, input.expectedSha256, input.data),
    };
}

async function finalizeExport(input: {
    sagaId: string;
    owner: AgentWorkOwner;
    authorization: AgentAssetExportAuthorization;
}): Promise<AgentAssetBoundaryResult> {
    if (isMalformedSagaId(input.sagaId)) {
        return { status: 'refused', reason: 'malformed-saga-id' };
    }

    return {
        status: 'receipt',
        receipt: await finalizeAgentAssetExport(input.sagaId, input.owner, input.authorization),
    };
}

async function cleanup(input: { sagaId: string | null; owner: AgentWorkOwner }): Promise<AgentAssetBoundaryResult> {
    if (input.sagaId !== null && isMalformedSagaId(input.sagaId)) {
        return { status: 'refused', reason: 'malformed-saga-id' };
    }

    return { status: 'receipt', receipt: await cleanupAgentAssetSaga(input.sagaId, input.owner) };
}

/**
 * The only way AiRuntime may drive the agent asset saga: every member takes an opaque handle or
 * saga id, never a path, and a malformed id is refused locally before any bridge call. Reach is
 * therefore bounded to what `pickAndRegister` already turned into a handle through the native
 * dialog's user-approved grant, never a name an agent can spell on its own.
 */
export const agentAssetFileBoundary = { pickAndRegister, importAsset, stageExport, finalizeExport, cleanup };
