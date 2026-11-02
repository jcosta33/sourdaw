import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { automationStore } from '#/modules/Automation/stores';
import { bacteriaStore } from '#/modules/Bacteria/stores';
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import { crustMeterStore, crustStore } from '#/modules/Crust/stores';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { glutenMeterStore, glutenStore } from '#/modules/Gluten/stores';
import { grinderStore, grinderTelemetryStore } from '#/modules/Grinder/stores';
import { kneadStore } from '#/modules/Knead/stores';
import { levainStore } from '#/modules/Levain/stores';
import { resetMidiStoreForProject } from '#/modules/MIDI/useCases';
import { proofStore } from '#/modules/Proof/stores';
import { toasterStore } from '#/modules/Toaster/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { tunerStore } from '#/modules/Tuner/stores';

import { arrangementStore } from '../../../../stores/arrangementStore';
import { missingMediaStore } from '../../../../stores/missingMediaStore';
import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';
import { type HydratableProjectData } from '../isHydratableProjectData';
import { resetModuleStoresToDefault } from '../resetModuleStoresToDefault';

const calls = vi.hoisted(() => [] as string[]);
const record = vi.hoisted(() => (step: string) => () => {
    calls.push(step);
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    resetArrangementStoresForProject: vi.fn(record('Arrangement.resetArrangementStoresForProject')),
    restoreAdjustmentLayerSnapshot: vi.fn(record('Arrangement.restoreAdjustmentLayerSnapshot')),
    hydrateVcaGroups: vi.fn(record('Arrangement.hydrateVcaGroups')),
    hydrateClipGainEnvelopes: vi.fn(record('Arrangement.hydrateClipGainEnvelopes')),
    hydrateClipWarpStates: vi.fn(record('Arrangement.hydrateClipWarpStates')),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    cancelActiveAgentRuns: vi.fn(record('AiRuntime.cancelActiveAgentRuns')),
}));

vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    clearAgentSectionRenderArtifacts: vi.fn(record('AudioRendering.clearAgentSectionRenderArtifacts')),
    clearAgentMeasurementArtifacts: vi.fn(record('AudioRendering.clearAgentMeasurementArtifacts')),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setMasterGainValue: vi.fn(record('AudioEngine.setMasterGainValue')),
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    hydrateModulationState: vi.fn(record('Automation.hydrateModulationState')),
}));

vi.mock('#/modules/CvGate/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CvGate/useCases')>()),
    hydrateCvGateState: vi.fn(record('CvGate.hydrateCvGateState')),
}));

vi.mock('#/modules/GrandBoule/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/GrandBoule/stores')>()),
    resetGrandBouleStores: vi.fn(record('GrandBoule.resetGrandBouleStores')),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiStoreForProject: vi.fn(record('MIDI.resetMidiStoreForProject')),
    hydrateGrooveTemplates: vi.fn(record('MIDI.hydrateGrooveTemplates')),
    replaceChordTrackState: vi.fn(record('MIDI.replaceChordTrackState')),
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    setSidechainRoutes: vi.fn(record('Routing.setSidechainRoutes')),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    restoreTransportSnapshot: vi.fn(record('Transport.restoreTransportSnapshot')),
}));

vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    hydrateYeastState: vi.fn(record('Yeast.hydrateYeastState')),
}));

/**
 * Every store write the reset and hydrate make, labelled by owner. A step that
 * runs inside an owner use case is observed on the store it writes, because the
 * store instance is the same however the owner reaches it.
 */
const STORE_WRITES = {
    'Project.arrangementStore': arrangementStore,
    'Project.missingMediaStore': missingMediaStore,
    'Transport.transportStore': transportStore,
    'Automation.automationStore': automationStore,
    'Transport.tempoMapStore': tempoMapStore,
    'Transport.timeSignatureMapStore': timeSignatureMapStore,
    'Gluten.glutenStore': glutenStore,
    'Gluten.glutenMeterStore': glutenMeterStore,
    'Fermenter.fermenterStore': fermenterStore,
    'Grinder.grinderStore': grinderStore,
    'Grinder.grinderTelemetryStore': grinderTelemetryStore,
    'Bacteria.bacteriaStore': bacteriaStore,
    'Proof.proofStore': proofStore,
    'Tuner.tunerStore': tunerStore,
    'Toaster.toasterStore': toasterStore,
    'Levain.levainStore': levainStore,
    'Crust.crustStore': crustStore,
    'Crust.crustMeterStore': crustMeterStore,
    'Knead.kneadStore': kneadStore,
    'ControlSurface.midiLearnStore': midiLearnStore,
} as const;

/**
 * The reset sequence the pre-registry `resetModuleStoresToDefault` produced,
 * written out by hand from that code and confirmed against it before the
 * registry replaced it. The agent run is cancelled before the
 * artifact stores its renders feed are cleared (#4783), and both happen after
 * Project's own stores and before any transport or device store is reset.
 */
const FULL_RESET_ORDER = [
    'Arrangement.resetArrangementStoresForProject',
    'Project.arrangementStore',
    'Project.missingMediaStore',
    'AiRuntime.cancelActiveAgentRuns',
    'AudioRendering.clearAgentSectionRenderArtifacts',
    'AudioRendering.clearAgentMeasurementArtifacts',
    'Transport.transportStore',
    'AudioEngine.setMasterGainValue',
    'Automation.automationStore',
    'MIDI.resetMidiStoreForProject',
    'MIDI.hydrateGrooveTemplates',
    'Yeast.hydrateYeastState',
    'Transport.tempoMapStore',
    'Transport.timeSignatureMapStore',
    'Routing.setSidechainRoutes',
    'Gluten.glutenStore',
    'Gluten.glutenMeterStore',
    'Fermenter.fermenterStore',
    'Grinder.grinderStore',
    'Grinder.grinderTelemetryStore',
    'Bacteria.bacteriaStore',
    'Proof.proofStore',
    'Tuner.tunerStore',
    'Toaster.toasterStore',
    'Levain.levainStore',
    'GrandBoule.resetGrandBouleStores',
    'Crust.crustStore',
    'Crust.crustMeterStore',
    'Knead.kneadStore',
] as const;

/** The hydrate sequence the pre-registry `hydrateModuleStoresFromProjectData` produced. */
const HYDRATE_ORDER = [
    'Transport.restoreTransportSnapshot',
    'Arrangement.restoreAdjustmentLayerSnapshot',
    'MIDI.replaceChordTrackState',
    'MIDI.hydrateGrooveTemplates',
    'Yeast.hydrateYeastState',
    'Arrangement.hydrateVcaGroups',
    'Arrangement.hydrateClipGainEnvelopes',
    'Arrangement.hydrateClipWarpStates',
    'Automation.hydrateModulationState',
    'CvGate.hydrateCvGateState',
    'ControlSurface.midiLearnStore',
    'Routing.setSidechainRoutes',
] as const;

function recordStoreWrites(): void {
    for (const [step, store] of Object.entries(STORE_WRITES)) {
        vi.spyOn(store, 'set').mockImplementation(record(step));
    }
}

function createProjectData(): HydratableProjectData {
    return {
        version: 1,
        meta: {
            name: 'Project',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'Major',
            tuning: { name: 'Equal temperament', frequencies: [] },
        },
        arrangement: { tracks: [] },
    };
}

describe('project lifecycle order', () => {
    beforeEach(() => {
        calls.length = 0;
        registerProjectLifecycle();
        recordStoreWrites();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('resets every owner in the pinned order', () => {
        resetModuleStoresToDefault();

        expect(calls).toEqual(FULL_RESET_ORDER);
        expect(resetMidiStoreForProject).toHaveBeenCalledExactlyOnceWith({ generateProbabilitySeed: false });
    });

    it('hands a new probability seed request to the MIDI owner', () => {
        resetModuleStoresToDefault({ createNewMidiProbabilitySeed: true });

        expect(calls).toEqual(FULL_RESET_ORDER);
        expect(resetMidiStoreForProject).toHaveBeenCalledExactlyOnceWith({ generateProbabilitySeed: true });
    });

    it('skips only the MIDI, groove and Yeast resets a project load leaves to hydration', () => {
        resetModuleStoresToDefault({ resetGrooveTemplates: false, resetMidiState: false, resetYeastState: false });

        expect(calls).toEqual(
            FULL_RESET_ORDER.filter(
                (step) =>
                    step !== 'MIDI.resetMidiStoreForProject' &&
                    step !== 'MIDI.hydrateGrooveTemplates' &&
                    step !== 'Yeast.hydrateYeastState'
            )
        );
    });

    it('hydrates every owner in the pinned order', () => {
        hydrateModuleStoresFromProjectData(createProjectData());

        expect(calls).toEqual(HYDRATE_ORDER);
    });
});
