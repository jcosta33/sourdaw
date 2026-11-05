import { collaborationAssetTransfer } from '#/modules/Arrangement/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type SupportingServicePorts = {
    collaborationAssetTransfer: Parameters<typeof collaborationAssetTransfer.configure>[0];
};

let productionPorts: SupportingServicePorts | null = null;

function buildProductionPorts(): SupportingServicePorts {
    return {
        collaborationAssetTransfer: {
            current: getAssetTransfer,
            isSessionActive: () => collaborationStore.value?.isEnabled ?? false,
        },
    };
}

/**
 * Core modules may not import the supporting modules that orbit them, so the
 * collaboration asset runtime reaches them through ports this composition
 * root fills. Called by bootstrap and again when `App` loads, beside
 * `registerDeviceEnginePorts`, because `main.tsx` loads the two
 * independently; registering the same ports twice is a no-op.
 */
export function registerSupportingServicePorts(): void {
    productionPorts ??= buildProductionPorts();
    collaborationAssetTransfer.configure(productionPorts.collaborationAssetTransfer);
}
