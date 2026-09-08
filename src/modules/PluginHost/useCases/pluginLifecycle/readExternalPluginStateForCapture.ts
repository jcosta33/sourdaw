import { bytesToBase64 } from '#/utils/base64';

import { getPluginState } from '../../repositories/pluginBridge/getPluginState';

import { externalPluginActivationTasks } from './externalPluginActivationTasks';
import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function preservationReason(instanceId: string): 'restore-failed' | 'restore-pending' | 'not-loaded' | null {
    if (externalPluginRestoreFailures.has(instanceId)) {
        return 'restore-failed';
    }
    if (externalPluginActivationTasks.has(instanceId)) {
        return 'restore-pending';
    }
    if (!loadedExternalInstances.has(instanceId)) {
        return 'not-loaded';
    }
    return null;
}

/** Read host state together with the exact native-instance generation that produced it. */
export function readExternalPluginStateForCapture(instanceId: string): Promise<
    | Readonly<{
          status: 'captured';
          stateChunk: string;
          authorityToken: object;
          isCurrent: () => boolean;
      }>
    | Readonly<{
          status: 'preserve';
          reason: 'restore-pending' | 'restore-failed' | 'not-loaded' | 'empty' | 'read-failed';
      }>
    | Readonly<{ status: 'stale'; authorityToken: object }>
> {
    return serializePluginLifecycle(instanceId, async () => {
        const beforeRead = preservationReason(instanceId);
        if (beforeRead) {
            return { status: 'preserve' as const, reason: beforeRead };
        }

        const authorityToken = externalPluginStateCaptureAuthority.current(instanceId);
        let bytes: Uint8Array;
        try {
            bytes = await getPluginState(instanceId);
        } catch {
            if (externalPluginRestoreFailures.has(instanceId)) {
                return { status: 'preserve' as const, reason: 'restore-failed' as const };
            }
            if (externalPluginActivationTasks.has(instanceId)) {
                return { status: 'preserve' as const, reason: 'restore-pending' as const };
            }
            return { status: 'preserve' as const, reason: 'read-failed' as const };
        }

        const afterRead = preservationReason(instanceId);
        if (afterRead === 'restore-failed' || afterRead === 'restore-pending') {
            return { status: 'preserve' as const, reason: afterRead };
        }
        if (afterRead === 'not-loaded' || !externalPluginStateCaptureAuthority.isCurrent(instanceId, authorityToken)) {
            return {
                status: 'stale' as const,
                authorityToken: externalPluginStateCaptureAuthority.current(instanceId),
            };
        }
        if (bytes.length === 0) {
            return { status: 'preserve' as const, reason: 'empty' as const };
        }

        return {
            status: 'captured' as const,
            stateChunk: bytesToBase64(bytes),
            authorityToken,
            isCurrent: () =>
                loadedExternalInstances.has(instanceId) &&
                !externalPluginActivationTasks.has(instanceId) &&
                !externalPluginRestoreFailures.has(instanceId) &&
                externalPluginStateCaptureAuthority.isCurrent(instanceId, authorityToken),
        };
    });
}
