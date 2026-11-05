import { collaborationAssetTransfer } from '#/modules/Arrangement/useCases';
import { midiNoteEditSource } from '#/modules/BrowserAi/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import { completeMidiLearn, getMidiLearnState, handleMidiMessage } from '#/modules/ControlSurface/useCases';
import { cvGateStore } from '#/modules/CvGate/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { midiLearnRouting } from '#/modules/MIDI/useCases';
import { cvGateProjection, midiLearnProjection, sampleDiscoverySource } from '#/modules/Project/useCases';
import { libraryStore } from '#/modules/SampleLibrary/stores';
import { searchAgentCatalog } from '#/modules/SampleLibrary/useCases';

type SupportingServicePorts = {
    collaborationAssetTransfer: Parameters<typeof collaborationAssetTransfer.configure>[0];
    cvGateProjection: Parameters<typeof cvGateProjection.configure>[0];
    midiLearnRouting: Parameters<typeof midiLearnRouting.configure>[0];
    midiLearnProjection: Parameters<typeof midiLearnProjection.configure>[0];
    midiNoteEditSource: Parameters<typeof midiNoteEditSource.configure>[0];
    sampleDiscoverySource: Parameters<typeof sampleDiscoverySource.configure>[0];
};

let productionPorts: SupportingServicePorts | null = null;

function buildProductionPorts(): SupportingServicePorts {
    return {
        collaborationAssetTransfer: {
            current: getAssetTransfer,
            isSessionActive: () => collaborationStore.value?.isEnabled ?? false,
        },
        cvGateProjection: { readCvGate: () => cvGateStore.value },
        midiLearnRouting: {
            getMidiLearnState,
            completeMidiLearn,
            applyMidiMappings: handleMidiMessage,
        },
        midiLearnProjection: { readMidiLearn: () => midiLearnStore.value },
        midiNoteEditSource: { subscribe: (listener) => midiStore.subscribe(listener) },
        sampleDiscoverySource: {
            readLibrary: () => libraryStore.value,
            searchCatalog: searchAgentCatalog,
        },
    };
}

/**
 * Lower-tier modules may not import the modules that orbit them, so the
 * collaboration asset runtime, MIDI learn routing, the saved MIDI learn
 * mappings, the saved CV/gate outputs, the MIDI note edits rendered phrases go
 * stale on and the sample catalog reach them through ports this composition
 * root fills. Called by bootstrap and again when `App` loads, beside
 * `registerDeviceEnginePorts`, because `main.tsx` loads the two independently;
 * registering the same ports twice is a no-op.
 */
export function registerSupportingServicePorts(): void {
    productionPorts ??= buildProductionPorts();
    collaborationAssetTransfer.configure(productionPorts.collaborationAssetTransfer);
    cvGateProjection.configure(productionPorts.cvGateProjection);
    midiLearnRouting.configure(productionPorts.midiLearnRouting);
    midiLearnProjection.configure(productionPorts.midiLearnProjection);
    midiNoteEditSource.configure(productionPorts.midiNoteEditSource);
    sampleDiscoverySource.configure(productionPorts.sampleDiscoverySource);
}
