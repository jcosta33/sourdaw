import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { agentMeasurementArtifactStore, agentSectionRenderArtifactStore } from '#/modules/AudioRendering/stores';
import { automationStore } from '#/modules/Automation/stores';
import { bacteriaStore } from '#/modules/Bacteria/stores';
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import { crustMeterStore, crustStore } from '#/modules/Crust/stores';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { glutenMeterStore, glutenStore, updateGlutenMeters } from '#/modules/Gluten/stores';
import { createDefaultGrandBouleState, createGrandBouleStore } from '#/modules/GrandBoule/stores';
import { grinderStore, grinderTelemetryStore } from '#/modules/Grinder/stores';
import { defaultKneadState, kneadStore } from '#/modules/Knead/stores';
import { levainStore } from '#/modules/Levain/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, updatePreferences } from '#/modules/Preferences/useCases';
import { proofStore } from '#/modules/Proof/stores';
import { defaultToasterState, toasterStore } from '#/modules/Toaster/stores';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { tunerStore } from '#/modules/Tuner/stores';

import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { defaultMissingMediaStoreState, missingMediaStore } from '../../../../stores/missingMediaStore';
import { projectLifecycleRegistry } from '../../projectLifecycleRegistry';
import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';
import { type HydratableProjectData } from '../isHydratableProjectData';
import { resetModuleStoresToDefault } from '../resetModuleStoresToDefault';

const owners = vi.hoisted(() => ({
    resetArrangementStoresForProject: vi.fn(),
    restoreAdjustmentLayerSnapshot: vi.fn(),
    hydrateVcaGroups: vi.fn(),
    hydrateClipGainEnvelopes: vi.fn(),
    hydrateClipWarpStates: vi.fn(),
    cancelActiveAgentRuns: vi.fn(),
    setMasterGainValue: vi.fn(),
    hydrateModulationState: vi.fn(),
    hydrateCvGateState: vi.fn(),
    resetMidiStoreForProject: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    replaceChordTrackState: vi.fn(),
    setSidechainRoutes: vi.fn(),
    restoreTransportSnapshot: vi.fn(),
    hydrateYeastState: vi.fn(),
}));

// The owners whose own code this change leaves untouched are observed at
// their entry point, with the arguments the pre-registry reset and hydrate
// passed them. Every store write that moved into a new owner use case is
// observed on the store itself, below.
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    resetArrangementStoresForProject: owners.resetArrangementStoresForProject,
    restoreAdjustmentLayerSnapshot: owners.restoreAdjustmentLayerSnapshot,
    hydrateVcaGroups: owners.hydrateVcaGroups,
    hydrateClipGainEnvelopes: owners.hydrateClipGainEnvelopes,
    hydrateClipWarpStates: owners.hydrateClipWarpStates,
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    cancelActiveAgentRuns: owners.cancelActiveAgentRuns,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setMasterGainValue: owners.setMasterGainValue,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    hydrateModulationState: owners.hydrateModulationState,
}));

vi.mock('#/modules/CvGate/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CvGate/useCases')>()),
    hydrateCvGateState: owners.hydrateCvGateState,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiStoreForProject: owners.resetMidiStoreForProject,
    hydrateGrooveTemplates: owners.hydrateGrooveTemplates,
    replaceChordTrackState: owners.replaceChordTrackState,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    setSidechainRoutes: owners.setSidechainRoutes,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    restoreTransportSnapshot: owners.restoreTransportSnapshot,
}));

vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    hydrateYeastState: owners.hydrateYeastState,
}));

type Expectation = {
    /** Leave state behind the way the outgoing project would. */
    dirty: () => void;
    /** Assert what the pre-registry reset left after the switch. */
    verify: () => void;
};

const GRAND_BOULE_DEVICE_ID = 'outgoing-grand-boule';

/**
 * What the pre-registry `resetModuleStoresToDefault` did to each module, keyed
 * by the module that owns it, read off that code rather than off the
 * registration it is checked against.
 */
const RESET_EXPECTATIONS: Record<string, readonly Expectation[]> = {
    Arrangement: [
        {
            dirty: () => undefined,
            verify: () => expect(owners.resetArrangementStoresForProject).toHaveBeenCalledExactlyOnceWith(),
        },
    ],
    Project: [
        {
            dirty: () => arrangementStore.set({ arrangements: [], activeArrangementId: 'outgoing' }),
            verify: () => expect(arrangementStore.value).toEqual(defaultArrangementStoreState),
        },
        {
            dirty: () =>
                missingMediaStore.set({
                    items: [
                        {
                            bufferId: 'gone',
                            clipId: 'clip-1',
                            kind: 'clip',
                            label: 'Lost',
                            trackId: 'track-1',
                            trackName: 'Guitars',
                        },
                    ],
                }),
            verify: () => expect(missingMediaStore.value).toEqual(defaultMissingMediaStoreState),
        },
    ],
    AiRuntime: [
        {
            dirty: () => undefined,
            verify: () => expect(owners.cancelActiveAgentRuns).toHaveBeenCalledExactlyOnceWith(),
        },
    ],
    AudioRendering: [
        {
            dirty: () =>
                agentSectionRenderArtifactStore.set({
                    artifacts: [
                        {
                            owner: 'agent-section-render',
                            retention: 'session',
                            jobId: 'outgoing-render',
                            sectionId: 'section-1',
                            sectionName: 'Chorus',
                            startBeat: 0,
                            endBeat: 16,
                            sampleRate: 48_000,
                            tailSeconds: 0,
                            sourceRevision: 'revision-1',
                            renderedAt: Date.now(),
                            durationSeconds: 2,
                            frameCount: 96_000,
                            channelCount: 2,
                            byteSize: 768_000,
                            contentAddress: 'outgoing-section-render',
                            warnings: [],
                            buffer: {} as AudioBuffer,
                        },
                    ],
                }),
            verify: () => expect(agentSectionRenderArtifactStore.value).toEqual({ artifacts: [] }),
        },
        {
            dirty: () =>
                agentMeasurementArtifactStore.set({
                    artifacts: [
                        {
                            owner: 'agent-measurement',
                            retention: 'session',
                            contentAddress: 'outgoing-measurement',
                            sourceRevision: 'revision-1',
                            renderedAt: Date.now(),
                            sampleRate: 48_000,
                            frameCount: 48_000,
                            channelCount: 2,
                            durationSeconds: 1,
                            byteSize: 384_000,
                            buffer: {} as AudioBuffer,
                        },
                    ],
                }),
            verify: () => expect(agentMeasurementArtifactStore.value).toEqual({ artifacts: [] }),
        },
    ],
    Transport: [
        {
            dirty: () => transportStore.set({ ...defaultTransportState, tempo: 97, isLooping: true, masterGain: 40 }),
            // The Recording preferences sit at their defaults in this spec.
            verify: () =>
                expect(transportStore.value).toEqual({
                    ...defaultTransportState,
                    countInEnabled: false,
                    countInBars: 1,
                    preRollEnabled: false,
                    preRollBars: 2,
                }),
        },
        {
            dirty: () => tempoMapStore.set({ changes: [{ id: 'tempo-1', beat: 4, tempo: 90, curve: 'instant' }] }),
            verify: () => expect(tempoMapStore.value).toEqual({ changes: [] }),
        },
        {
            dirty: () =>
                timeSignatureMapStore.set({ changes: [{ id: 'meter-1', beat: 4, numerator: 6, denominator: 8 }] }),
            verify: () => expect(timeSignatureMapStore.value).toEqual({ changes: [] }),
        },
    ],
    AudioEngine: [
        {
            dirty: () => undefined,
            verify: () =>
                expect(owners.setMasterGainValue).toHaveBeenCalledExactlyOnceWith(
                    defaultTransportState.masterGain / 100
                ),
        },
    ],
    Automation: [
        {
            dirty: () =>
                automationStore.set({
                    lanes: [
                        {
                            id: 'lane-1',
                            trackId: 'track-1',
                            parameterId: 'volume',
                            parameterName: 'Volume',
                            points: [],
                            objects: [],
                            visible: true,
                            enabled: true,
                            collapsed: false,
                            minValue: 0,
                            maxValue: 1,
                        },
                    ],
                }),
            verify: () => expect(automationStore.value).toEqual({ lanes: [] }),
        },
    ],
    MIDI: [
        {
            dirty: () => undefined,
            verify: () => {
                expect(owners.resetMidiStoreForProject).toHaveBeenCalledExactlyOnceWith({
                    generateProbabilitySeed: false,
                });
                expect(owners.hydrateGrooveTemplates).toHaveBeenCalledExactlyOnceWith({
                    templates: [],
                    assignments: [],
                });
            },
        },
    ],
    Yeast: [
        {
            dirty: () => undefined,
            verify: () => expect(owners.hydrateYeastState).toHaveBeenCalledExactlyOnceWith(undefined),
        },
    ],
    Routing: [
        {
            dirty: () => undefined,
            verify: () => expect(owners.setSidechainRoutes).toHaveBeenCalledExactlyOnceWith([]),
        },
    ],
    Gluten: [
        storeClearedToEmpty(glutenStore),
        {
            dirty: () => updateGlutenMeters('outgoing-gluten', { grDb: -7, inputDb: -20, outputDb: -13 }),
            verify: () => expect(glutenMeterStore.value).toEqual({}),
        },
    ],
    Fermenter: [storeClearedToEmpty(fermenterStore)],
    Grinder: [storeClearedToEmpty(grinderStore), storeClearedToEmpty(grinderTelemetryStore)],
    Bacteria: [storeClearedToEmpty(bacteriaStore)],
    Proof: [storeClearedToEmpty(proofStore)],
    Tuner: [storeClearedToEmpty(tunerStore)],
    Toaster: [
        {
            dirty: () => toasterStore.set({ 'outgoing-toaster': defaultToasterState }),
            verify: () => expect(toasterStore.value).toEqual({}),
        },
    ],
    Levain: [storeClearedToEmpty(levainStore)],
    GrandBoule: [
        {
            // Grand Boule keeps one store per device: every one of them resets.
            dirty: () =>
                createGrandBouleStore(GRAND_BOULE_DEVICE_ID).set({ ...createDefaultGrandBouleState(), temperament: 4 }),
            verify: () =>
                expect(createGrandBouleStore(GRAND_BOULE_DEVICE_ID).value).toEqual(createDefaultGrandBouleState()),
        },
    ],
    Crust: [storeClearedToEmpty(crustStore), storeClearedToEmpty(crustMeterStore)],
    Knead: [
        {
            dirty: () => kneadStore.set({ ...defaultKneadState, activeClipId: 'outgoing-clip', isAnalyzing: true }),
            verify: () => expect(kneadStore.value).toBe(defaultKneadState),
        },
    ],
};

type DeviceInstanceStore = { set: (value: Record<string, never>) => void; readonly value: unknown };

/**
 * A per-device instance store the reset empties. The write is observed as well
 * as the value, because a store that already holds `{}` reads the same whether
 * or not the reset reached it.
 */
function storeClearedToEmpty(store: DeviceInstanceStore): Expectation {
    const writes: unknown[] = [];
    return {
        dirty: () => {
            writes.length = 0;
            vi.spyOn(store, 'set').mockImplementation((value) => {
                writes.push(value);
            });
        },
        verify: () => expect(writes).toEqual([{}]),
    };
}

const MIDI_LEARN_SNAPSHOT = {
    mappingsSchemaVersion: 1,
    mappings: [
        {
            id: 'mapping-volume-cc7',
            channel: 0,
            cc: 7,
            targetType: 'trackGain' as const,
            trackId: 'track-vox',
            minValue: 0,
            maxValue: 1,
        },
    ],
    // A loaded file never arms learning.
    isLearning: true,
    learningTarget: null,
};

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
        transport: { ...defaultTransportState, tempo: 128 },
        adjustmentLayers: { layers: [] },
        chordTrack: { enabled: true, events: [] },
        grooves: { templates: [], assignments: [] },
        yeast: { racks: { 'device-a': { processors: [] } } },
        vcaGroups: [{ id: 'vca-drums', name: 'Drums', gain: 0.5, muted: false, trackIds: ['track-kick'] }],
        gainEnvelopes: [{ clipId: 'clip-vox', enabled: true, points: [] }],
        warpStates: [],
        modulation: { modulators: [] },
        cvGate: {
            outputs: [],
            voltageStandard: 'hz-per-volt',
            clockDivision: 2,
            triggerPulseMs: 5,
            gateThreshold: 1,
        },
        midiLearn: MIDI_LEARN_SNAPSHOT,
        sidechainRoutes: [
            {
                id: 'route-1',
                sourceTrackId: 'source',
                targetTrackId: 'target',
                targetDeviceId: 'device',
                targetParameterId: 'threshold',
                gain: 1,
            },
        ],
    };
}

/**
 * What the pre-registry `hydrateModuleStoresFromProjectData` did with each
 * field of a loaded file, keyed by the module that owns it.
 */
const HYDRATE_EXPECTATIONS: Record<string, (data: HydratableProjectData) => void> = {
    Transport: (data) => expect(owners.restoreTransportSnapshot).toHaveBeenCalledExactlyOnceWith(data.transport),
    Arrangement: (data) => {
        expect(owners.restoreAdjustmentLayerSnapshot).toHaveBeenCalledExactlyOnceWith(data.adjustmentLayers);
        expect(owners.hydrateVcaGroups).toHaveBeenCalledExactlyOnceWith(data.vcaGroups);
        expect(owners.hydrateClipGainEnvelopes).toHaveBeenCalledExactlyOnceWith(data.gainEnvelopes);
        expect(owners.hydrateClipWarpStates).toHaveBeenCalledExactlyOnceWith(data.warpStates);
    },
    MIDI: (data) => {
        expect(owners.replaceChordTrackState).toHaveBeenCalledExactlyOnceWith(data.chordTrack);
        expect(owners.hydrateGrooveTemplates).toHaveBeenCalledExactlyOnceWith(data.grooves);
    },
    Yeast: (data) => expect(owners.hydrateYeastState).toHaveBeenCalledExactlyOnceWith(data.yeast),
    Automation: (data) => expect(owners.hydrateModulationState).toHaveBeenCalledExactlyOnceWith(data.modulation),
    CvGate: (data) => expect(owners.hydrateCvGateState).toHaveBeenCalledExactlyOnceWith(data.cvGate),
    ControlSurface: () => expect(midiLearnStore.value).toEqual({ ...MIDI_LEARN_SNAPSHOT, isLearning: false }),
    Routing: (data) => expect(owners.setSidechainRoutes).toHaveBeenCalledExactlyOnceWith(data.sidechainRoutes),
};

function registeredModules(phase: 'resetForProject' | 'hydrateFromProjectData'): Set<string> {
    return new Set(
        projectLifecycleRegistry
            .read('spec')
            .filter((participant) => participant[phase] !== undefined)
            .map(({ module }) => module)
    );
}

describe('project lifecycle preservation', () => {
    beforeEach(() => {
        registerProjectLifecycle();
        preferencesStore.set(defaultPreferences);
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        midiLearnStore.set({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });
    });

    it('registers a reset for exactly the modules a project switch reset before the registry', () => {
        expect(registeredModules('resetForProject')).toEqual(new Set(Object.keys(RESET_EXPECTATIONS)));
    });

    it('registers a hydrate for exactly the modules a project load hydrated before the registry', () => {
        expect(registeredModules('hydrateFromProjectData')).toEqual(new Set(Object.keys(HYDRATE_EXPECTATIONS)));
    });

    it('leaves every module where the pre-registry reset left it', () => {
        const expectations = Object.values(RESET_EXPECTATIONS).flat();
        for (const { dirty } of expectations) {
            dirty();
        }

        resetModuleStoresToDefault();

        for (const { verify } of expectations) {
            verify();
        }
    });

    it('seeds the new project transport from non-default Recording preferences', () => {
        updatePreferences({ patch: { recordCountIn: 2, preRollEnabled: true, preRollBars: 1 } });
        transportStore.set({ ...defaultTransportState, tempo: 97 });

        resetModuleStoresToDefault();

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 1,
        });
    });

    it('hands every loaded field to the module that hydrated it before the registry', () => {
        const data = createProjectData();
        midiLearnStore.set({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });

        hydrateModuleStoresFromProjectData(data);

        for (const verify of Object.values(HYDRATE_EXPECTATIONS)) {
            verify(data);
        }
    });
});
