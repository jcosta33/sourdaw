import { automationStore } from '#/modules/Automation/stores';
import { macroCoreReads } from '#/modules/Command/useCases';
import { branchSwitchTransport } from '#/modules/CrdtDocument/useCases';
import { readTempoAtBeat, readTempoMapEditTargets } from '#/modules/Transport/stores';
import { isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';

type KernelPorts = {
    macroCoreReads: Parameters<typeof macroCoreReads.configure>[0];
    branchSwitchTransport: Parameters<typeof branchSwitchTransport.configure>[0];
};

let productionPorts: KernelPorts | null = null;

function buildProductionPorts(): KernelPorts {
    return {
        macroCoreReads: {
            readTempoAtBeat,
            readTempoMapEditTargets,
            readAutomationLanes: () => automationStore.value?.lanes,
        },
        branchSwitchTransport: { isIdle: isTransportIdle, stop: stopPlayback },
    };
}

/**
 * The kernel modules may not import the core domains they serve, so the core
 * state macro replay reads reaches Command, and the transport a branch switch
 * stops reaches CrdtDocument, through ports this composition root fills. Called by bootstrap and again when `App` loads, beside
 * `registerSupportingServicePorts`, because `main.tsx` loads the two
 * independently; registering the same ports twice is a no-op.
 */
export function registerKernelPorts(): void {
    productionPorts ??= buildProductionPorts();
    macroCoreReads.configure(productionPorts.macroCoreReads);
    branchSwitchTransport.configure(productionPorts.branchSwitchTransport);
}
