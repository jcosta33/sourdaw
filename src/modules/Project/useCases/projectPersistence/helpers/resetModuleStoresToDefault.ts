import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation';
import { bacteriaStore } from '#/modules/Bacteria/stores';
import { crustStore, defaultCrustState } from '#/modules/Crust/stores';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { glutenStore } from '#/modules/Gluten/stores';
import { grandBouleStore, defaultGrandBouleState } from '#/modules/GrandBoule/stores';
import { grinderStore } from '#/modules/Grinder/stores';
import { kneadStore, defaultKneadState } from '#/modules/Knead/stores';
import { levainStore, defaultLevainState } from '#/modules/Levain/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { proofStore } from '#/modules/Proof/stores';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { scoringStore } from '#/modules/Scoring/stores';
import { toasterStore, defaultToasterState } from '#/modules/Toaster/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

export function resetModuleStoresToDefault(): void {
    trackStore.set({ tracks: [], selectedTrackId: null });
    transportStore.set(defaultTransportState);
    automationStore.set({ lanes: [] });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
    setSidechainRoutes([]);

    // Reset per-device-instance stores (§13.1 — prevents stale device state
    // from previous project leaking into newly loaded projects)
    glutenStore.set({});
    fermenterStore.set({});
    grinderStore.set({});
    bacteriaStore.set({});
    proofStore.set({});
    scoringStore.set({});
    toasterStore.set(defaultToasterState);
    levainStore.set(defaultLevainState);
    grandBouleStore.set(defaultGrandBouleState);
    crustStore.set(defaultCrustState);
    kneadStore.set(defaultKneadState);
}
