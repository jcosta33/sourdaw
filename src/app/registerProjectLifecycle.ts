import { cancelActiveAgentRuns } from '#/modules/AiRuntime/useCases';
import {
    hydrateClipGainEnvelopes,
    hydrateClipWarpStates,
    hydrateVcaGroups,
    resetArrangementStoresForProject,
    restoreAdjustmentLayerSnapshot,
} from '#/modules/Arrangement/useCases';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases';
import { clearAgentMeasurementArtifacts, clearAgentSectionRenderArtifacts } from '#/modules/AudioRendering/useCases';
import { hydrateModulationState, restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { resetBacteriaForProject } from '#/modules/Bacteria/useCases';
import { restoreMidiLearnSnapshot } from '#/modules/ControlSurface/useCases';
import { resetCrustForProject } from '#/modules/Crust/useCases';
import { hydrateCvGateState } from '#/modules/CvGate/useCases';
import { resetFermenterForProject } from '#/modules/Fermenter/useCases';
import { resetGlutenForProject } from '#/modules/Gluten/useCases';
import { resetGrandBouleForProject } from '#/modules/GrandBoule/useCases';
import { resetGrinderForProject } from '#/modules/Grinder/useCases';
import { resetKneadForProject } from '#/modules/Knead/useCases';
import { resetLevainForProject } from '#/modules/Levain/useCases';
import { hydrateGrooveTemplates, replaceChordTrackState, resetMidiStoreForProject } from '#/modules/MIDI/useCases';
import { projectLifecycleRegistry, resetProjectStoresForProject } from '#/modules/Project/useCases';
import { resetProofForProject } from '#/modules/Proof/useCases';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { resetToasterForProject } from '#/modules/Toaster/useCases';
import {
    defaultTransportState,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
    seedTransportForNewProject,
} from '#/modules/Transport/useCases';
import { resetTunerForProject } from '#/modules/Tuner/useCases';
import { hydrateYeastState } from '#/modules/Yeast/useCases';

type ProjectLifecycleParticipants = Parameters<typeof projectLifecycleRegistry.configure>[0];

let productionParticipants: ProjectLifecycleParticipants | null = null;

/**
 * Every module a project switch resets or a project load hydrates, in the
 * order both phases run. A module that takes part at two points of a phase is
 * listed once per point; the order is pinned by
 * `Project/.../helpers/__tests__/projectLifecycleOrder.spec.ts`.
 */
function buildProductionParticipants(): ProjectLifecycleParticipants {
    return [
        { module: 'Arrangement', resetForProject: () => resetArrangementStoresForProject() },
        { module: 'Project', resetForProject: () => resetProjectStoresForProject() },
        {
            // An agent run in flight is bound to the project being torn down:
            // cancel it before the artifact stores its renders feed are
            // cleared, so its renders abort through the run's own cancellation
            // machinery and free the process-wide render lock for the incoming
            // project (#4783).
            module: 'AiRuntime',
            resetForProject: () => cancelActiveAgentRuns(),
        },
        {
            // Retained agent section and measurement renders describe the
            // project being torn down; clearing them also drops their expiry
            // timers (#4767).
            module: 'AudioRendering',
            resetForProject: () => {
                clearAgentSectionRenderArtifacts();
                clearAgentMeasurementArtifacts();
            },
        },
        {
            module: 'Transport',
            resetForProject: () => seedTransportForNewProject(),
            // Unconditional: a project file with no transport block must not
            // inherit the outgoing project's — or the preference-seeded —
            // transport through the preceding reset. `restoreTransportSnapshot`
            // sanitizes an absent block to the model defaults.
            hydrateFromProjectData: (data) => restoreTransportSnapshot(data.transport),
        },
        {
            // Master gain has no Recording preference: it starts on the model default.
            module: 'AudioEngine',
            resetForProject: () => setMasterGainValue(defaultTransportState.masterGain / 100),
        },
        {
            // Adjustment layers hydrate after the active arrangement, which the
            // load restores before this phase, so their affectedTrackIds resolve.
            module: 'Arrangement',
            part: 'adjustment layers',
            hydrateFromProjectData: (data) => restoreAdjustmentLayerSnapshot(data.adjustmentLayers),
        },
        { module: 'Automation', resetForProject: () => restoreAutomationSnapshot({ lanes: [] }) },
        {
            module: 'MIDI',
            resetForProject: ({ resetMidiState, createNewMidiProbabilitySeed, resetGrooveTemplates }) => {
                if (resetMidiState) {
                    resetMidiStoreForProject({ generateProbabilitySeed: createNewMidiProbabilitySeed });
                }
                if (resetGrooveTemplates) {
                    hydrateGrooveTemplates({ templates: [], assignments: [] });
                }
            },
            hydrateFromProjectData: (data) => {
                replaceChordTrackState(data.chordTrack);
                hydrateGrooveTemplates(data.grooves ?? { templates: [], assignments: [] });
            },
        },
        {
            module: 'Yeast',
            resetForProject: ({ resetYeastState }) => {
                if (resetYeastState) {
                    hydrateYeastState(undefined);
                }
            },
            hydrateFromProjectData: (data) => hydrateYeastState(data.yeast),
        },
        {
            module: 'Transport',
            part: 'timeline maps',
            resetForProject: () =>
                restoreTimelineMapSnapshot({ tempoMap: { changes: [] }, timeSignatureMap: { changes: [] } }),
        },
        {
            // Unconditional: each owner clears its store when the field is
            // absent, so a project that carries no mix state of a given kind
            // cannot inherit the outgoing project's.
            module: 'Arrangement',
            part: 'mix state',
            hydrateFromProjectData: (data) => {
                hydrateVcaGroups(data.vcaGroups);
                hydrateClipGainEnvelopes(data.gainEnvelopes);
                hydrateClipWarpStates(data.warpStates);
            },
        },
        {
            module: 'Automation',
            part: 'modulation',
            hydrateFromProjectData: (data) => hydrateModulationState(data.modulation),
        },
        { module: 'CvGate', hydrateFromProjectData: (data) => hydrateCvGateState(data.cvGate) },
        { module: 'ControlSurface', hydrateFromProjectData: (data) => restoreMidiLearnSnapshot(data.midiLearn) },
        {
            module: 'Routing',
            resetForProject: () => setSidechainRoutes([]),
            hydrateFromProjectData: (data) => setSidechainRoutes(data.sidechainRoutes ?? []),
        },
        { module: 'Gluten', resetForProject: () => resetGlutenForProject() },
        { module: 'Fermenter', resetForProject: () => resetFermenterForProject() },
        { module: 'Grinder', resetForProject: () => resetGrinderForProject() },
        { module: 'Bacteria', resetForProject: () => resetBacteriaForProject() },
        { module: 'Proof', resetForProject: () => resetProofForProject() },
        { module: 'Tuner', resetForProject: () => resetTunerForProject() },
        { module: 'Toaster', resetForProject: () => resetToasterForProject() },
        { module: 'Levain', resetForProject: () => resetLevainForProject() },
        {
            // Grand Boule keeps a Map of per-device store instances, not one
            // Record<deviceId, State> store, so one `.set(default)` would leave
            // every other device's slice to leak into the next project;
            // resetGrandBouleForProject resets every per-device store (§13.1).
            module: 'GrandBoule',
            resetForProject: () => resetGrandBouleForProject(),
        },
        { module: 'Crust', resetForProject: () => resetCrustForProject() },
        { module: 'Knead', resetForProject: () => resetKneadForProject() },
    ];
}

/**
 * Give Project the modules its reset and hydrate reach. Most of them sit in a
 * tier Project may not depend on, and AiRuntime and AudioRendering import
 * Project themselves, so the composition root supplies them; until it does,
 * resetting or hydrating a project throws.
 *
 * Bootstrap calls this once before anything can reset or load a project. Specs
 * that reach a real reset or hydrate call it in their setup. Repeating it is
 * safe: the list is built once per module instance, and registering the
 * identical list again is a no-op.
 */
export function registerProjectLifecycle(): void {
    productionParticipants ??= buildProductionParticipants();
    projectLifecycleRegistry.configure(productionParticipants);
}
