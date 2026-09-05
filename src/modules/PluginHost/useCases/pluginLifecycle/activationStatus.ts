import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
    type ExternalPluginActivationStatus,
} from '../../stores/externalPluginActivationStore';

/**
 * The one writer for `externalPluginActivationStore`, so every caller keeps the entry shape (`{ status }` versus `{ status, message }`) identical.
 */
export function setActivationStatus(
    instanceId: string,
    status: ExternalPluginActivationStatus['status'],
    message?: string
): void {
    externalPluginActivationStore.update((state) => {
        const current = state ?? defaultExternalPluginActivationState;
        return {
            ...current,
            byInstanceId: {
                ...current.byInstanceId,
                [instanceId]: message ? { status, message } : { status },
            },
        };
    });
}
