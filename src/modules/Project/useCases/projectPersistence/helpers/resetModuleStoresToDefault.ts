import { resetArrangementStoresForProject } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { bacteriaStore } from '#/modules/Bacteria/stores';
import { crustStore, defaultCrustState } from '#/modules/Crust/stores';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { glutenStore, glutenMeterStore } from '#/modules/Gluten/stores';
import { resetGrandBouleStores } from '#/modules/GrandBoule/stores';
import { grinderStore, grinderTelemetryStore } from '#/modules/Grinder/stores';
import { kneadStore, defaultKneadState } from '#/modules/Knead/stores';
import { levainStore } from '#/modules/Levain/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { proofStore } from '#/modules/Proof/stores';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { scoringStore } from '#/modules/Scoring/stores';
import { toasterStore } from '#/modules/Toaster/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

export function resetModuleStoresToDefault(): void {
    resetArrangementStoresForProject();
    transportStore.set(defaultTransportState);
    automationStore.set({ lanes: [] });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
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
    scoringStore.set({});
    toasterStore.set({});
    levainStore.set({});
    // Grand Boule keeps a Map of per-device store instances (not a single
    // Record<deviceId, State> store), so a single `.set(default)` on the shim
    // would leave every other device's slice intact and leak it into the next
    // project. resetGrandBouleStores() resets every per-device store (§13.1).
    resetGrandBouleStores();
    crustStore.set(defaultCrustState);
    kneadStore.set(defaultKneadState);
}
