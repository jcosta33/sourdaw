import { getLegacyTrimInverseReplayFailure } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { commandProjectRevisionPort, legacyInverseReplayAdmission, macroCoreReads } from '#/modules/Command/useCases';
import {
    branchSwitchTransport,
    captureProjectMutationAuthorization,
    captureProjectRevision,
} from '#/modules/CrdtDocument/useCases';
import { readTempoAtBeat, readTempoMapEditTargets } from '#/modules/Transport/stores';
import { isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';

type KernelPorts = {
    legacyInverseReplayAdmission: Parameters<typeof legacyInverseReplayAdmission.configure>[0];
    macroCoreReads: Parameters<typeof macroCoreReads.configure>[0];
    branchSwitchTransport: Parameters<typeof branchSwitchTransport.configure>[0];
    commandProjectMutationAuthority: Parameters<typeof commandProjectRevisionPort.configureMutationAuthority>[0];
};

let productionPorts: KernelPorts | null = null;

function buildProductionPorts(): KernelPorts {
    return {
        legacyInverseReplayAdmission: { getLegacyTrimInverseReplayFailure },
        macroCoreReads: {
            readTempoAtBeat,
            readTempoMapEditTargets,
            readAutomationLanes: () => automationStore.value?.lanes,
        },
        branchSwitchTransport: { isIdle: isTransportIdle, stop: stopPlayback },
        commandProjectMutationAuthority: {
            revisionProvider: captureProjectRevision,
            captureMutationAuthorization: captureProjectMutationAuthorization,
        },
    };
}

/**
 * The kernel modules may not import the core domains they serve, so the
 * legacy trim admission undo replays through and the tempo and automation
 * state macro replay reads reach Command, and the transport a branch switch
 * stops reaches CrdtDocument, through ports this composition root fills.
 * Called by bootstrap and again when `App` loads, beside
 * `registerSupportingServicePorts`, because `main.tsx` loads the two
 * independently; registering the same ports twice is a no-op.
 */
export function registerKernelPorts(): void {
    productionPorts ??= buildProductionPorts();
    legacyInverseReplayAdmission.configure(productionPorts.legacyInverseReplayAdmission);
    macroCoreReads.configure(productionPorts.macroCoreReads);
    branchSwitchTransport.configure(productionPorts.branchSwitchTransport);
    commandProjectRevisionPort.configureMutationAuthority(productionPorts.commandProjectMutationAuthority);
}
