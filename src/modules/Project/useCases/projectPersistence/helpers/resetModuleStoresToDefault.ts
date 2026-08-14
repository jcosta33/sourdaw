import { resetArrangementStoresForProject } from '#/modules/Arrangement/useCases';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { bacteriaStore } from '#/modules/Bacteria/stores';
import { crustStore, defaultCrustState } from '#/modules/Crust/stores';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { glutenStore, glutenMeterStore } from '#/modules/Gluten/stores';
import { resetGrandBouleStores } from '#/modules/GrandBoule/stores';
import { grinderStore, grinderTelemetryStore } from '#/modules/Grinder/stores';
import { kneadStore, defaultKneadState } from '#/modules/Knead/stores';
import { levainStore } from '#/modules/Levain/stores';
import { hydrateGrooveTemplates, resetMidiStoreForProject } from '#/modules/MIDI/useCases';
import { proofStore } from '#/modules/Proof/stores';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { toasterStore, resetToasterDeviceLifecycleState } from '#/modules/Toaster/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { tunerStore } from '#/modules/Tuner/stores';
import { hydrateYeastState } from '#/modules/Yeast/useCases';

import { arrangementStore, defaultArrangementStoreState } from '../../../stores/arrangementStore';
import { defaultMissingMediaStoreState, missingMediaStore } from '../../../stores/missingMediaStore';

type ResetModuleStoresToDefaultInput = {
    createNewMidiProbabilitySeed?: boolean;
    resetGrooveTemplates?: boolean;
    resetMidiState?: boolean;
    resetYeastState?: boolean;
};

export function resetModuleStoresToDefault({
    createNewMidiProbabilitySeed = false,
    resetGrooveTemplates = true,
    resetMidiState = true,
    resetYeastState = true,
}: ResetModuleStoresToDefaultInput = {}): void {
    resetArrangementStoresForProject();
    arrangementStore.set(structuredClone(defaultArrangementStoreState));
    // The missing-media record describes the project being torn down. Every
    // caller either follows with `verifyAudioBufferReferences` (the load paths,
    // which re-derive it) or is `newProject`, which has no media to miss — so
    // clearing here is what stops a closed project's count from outliving it.
    missingMediaStore.set(structuredClone(defaultMissingMediaStoreState));
    transportStore.set(defaultTransportState);
    setMasterGainValue(defaultTransportState.masterGain / 100);
    automationStore.set({ lanes: [] });
    if (resetMidiState) {
        resetMidiStoreForProject({ generateProbabilitySeed: createNewMidiProbabilitySeed });
    }
    if (resetGrooveTemplates) {
        hydrateGrooveTemplates({ templates: [], assignments: [] });
    }
    if (resetYeastState) {
        hydrateYeastState(undefined);
    }
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    setSidechainRoutes([]);

    // Reset per-device-instance stores (§13.1 — prevents stale device state
    // from previous project leaking into newly loaded projects)
    glutenStore.set({});
    // Gluten holds high-frequency meter telemetry in a separate store from the
    // patch (like Grinder's grinderTelemetryStore below); reset it too so a
    // reopened panel for a reused deviceId does not show the prior project's
    // last meter readings.
    glutenMeterStore.set({});
    fermenterStore.set({});
    grinderStore.set({});
    grinderTelemetryStore.set({});
    bacteriaStore.set({});
    proofStore.set({});
    tunerStore.set({});
    toasterStore.set({});
    // The Toaster registration bookkeeping (deferred kit writes and retired
    // ids) is module-level state beside the store. Surviving a project
    // switch, it would either flush an abandoned write onto the incoming
    // project's same-id device — dirtying a just-loaded document — or refuse
    // its loading-window writes outright. Ids are per-document, so the
    // bookkeeping ends at the project boundary (§13.1).
    resetToasterDeviceLifecycleState();
    levainStore.set({});
    // Grand Boule keeps a Map of per-device store instances (not a single
    // Record<deviceId, State> store), so a single `.set(default)` on the shim
    // would leave every other device's slice intact and leak it into the next
    // project. resetGrandBouleStores() resets every per-device store (§13.1).
    resetGrandBouleStores();
    crustStore.set(defaultCrustState);
    kneadStore.set(defaultKneadState);
}
