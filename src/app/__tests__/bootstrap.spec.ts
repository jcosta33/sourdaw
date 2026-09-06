import { describe, it, expect, vi } from 'vitest';

import { getMidiTransform, getMidiTransformDescriptors, getMidiTransformNames } from '#/modules/Command/stores';

import { captureAgentProjectInspectionState } from '../captureCommandBatchPreflightState';

import type { setArrangementEventBus } from '#/modules/Arrangement/useCases';
import type {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import type { configureDurableAssetCommitProof } from '#/modules/Collaboration/useCases';
import type { setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import type { NotificationEventBus } from '#/utils/Notification/notificationEventBus';

// bootstrap.ts is the app's composition root: it imports ~40 module barrels
// and, at import time (not inside a callable function), wires their runtime
// dependencies and hands every module's `get<Module>Handlers()` result to the
// shared production handler assembler. There is no exported bootstrap function to call
// — the only way to exercise the wiring is to import the module and observe
// the side effects it performs while doing so.
//
// Every module bootstrap.ts imports from is mocked here so importing it stays
// hermetic (no real AudioContext, storage, or engine wiring runs). The
// `get<Module>Handlers` factories return a small sentinel object instead of a
// real handler map — the mocking boundary this spec is scoped to (see
// ledger #429) — so the test can assert on *which* modules got registered and
// in what order without depending on any module's internal action-type keys.

type HandlerMapSentinel = { moduleId: string };
type ArrangementEventBus = Parameters<typeof setArrangementEventBus>[0];
type RuntimeGraphProjectRevisionValidator = NonNullable<
    Parameters<typeof configureRuntimeGraphProjectRevisionValidator>[0]
>;
type RuntimeGraphTopologyValidator = NonNullable<Parameters<typeof configureRuntimeGraphTopologyValidator>[0]>;
type ProjectIdentityTransitionDependencies = Parameters<typeof setProjectIdentityTransitionDependencies>[0];
type DurableAssetOwnerRecoveryAfterProjectLoad = NonNullable<
    ProjectIdentityTransitionDependencies['resumeDurableAssetOwnerHandoffsAfterProjectLoad']
>;
type DurableAssetCommitProofProvider = Parameters<typeof configureDurableAssetCommitProof>[0];
type AssetTransferMock = {
    resumeDurableOwnerRebindsAfterProjectLoad: DurableAssetOwnerRecoveryAfterProjectLoad;
};

/**
 * The one sink member this spec asserts on. The offline render's device chain
 * calls it for every worklet-backed device it builds; bootstrap is the only place
 * that decides which device types have anything to prepare.
 */
type RuntimeSinkUnderTest = {
    prepareOfflineInstrument: (input: {
        deviceId: string;
        deviceType: string;
        port: MessagePort;
        signal?: AbortSignal;
    }) => Promise<void>;
};

const {
    noop,
    sentinelHandlers,
    assertCanonicalLlmActionStrategiesMock,
    getExecutableAppActionGroundingCatalogMock,
    executableAppActionGroundingCatalog,
    registerProductionCommandHandlersMock,
    configureCommandBatchIdempotencyMock,
    initBrowserAiMock,
    initRaveModelsMock,
    registerGlobalErrorHandlersMock,
    eventBusMock,
    loggerMock,
    actionHistoryStoreMock,
    trackStoreMock,
    setTimeOperationDependenciesMock,
    setVcaRuntimeProjectionDependenciesMock,
    reconcileVcaRuntimeGainMock,
    prepareAutomationTimeOperationMock,
    prepareAutomationTimeStateRestoreMock,
    prepareMidiGlobalTimeTransactionMock,
    prepareMidiTimeStateRestoreMock,
    prepareTimelineMapTimeOperationMock,
    prepareTimelineMapStateRestoreMock,
    configureAudioDeviceRuntimeSinkMock,
    canExecuteCommandBatchMock,
    configureCollaborationAssetOwnerMock,
    configureDurableAssetCommitProofMock,
    getAssetTransferMock,
    getDurableProjectOwnerIdMock,
    getVersionedCommandBatchCommitDispositionMock,
    prepareOfflineLevainMock,
    initBranchStateMock,
    recoverInterruptedAgentRunsMock,
    recoverRetainedSectionRenderEffectsMock,
    flushDeferredStorageNoticeMock,
    getAutomationParameterRangeMock,
    setAutomationParameterRangeResolverMock,
    setTrackGainMock,
    setTrackPanMock,
    setMidiLearnDependenciesMock,
    registerCrdtStorageRuntimeMock,
    captureProjectIdentityMock,
    captureProjectRevisionMock,
    projectRevisionMatchesLiveIgnoringCommandCheckpointMock,
    agentProjectInspectionSetProviderMock,
    setArrangementEventBusMock,
    configureRuntimeGraphProjectRevisionValidatorMock,
    configureRuntimeGraphTopologyValidatorMock,
    runtimeGraphTopologyMock,
    setNotificationEventBusMock,
    setProjectIdentityTransitionDependenciesMock,
    commandRuntimeRepairPortMock,
    repairRuntimeGraphFromProjectMock,
    sessionUndoWitnessStampPortMock,
    stampSessionUndoWitnessMock,
    composeGrandBouleMock,
    toasterGrooveExecutorMock,
    executeUserAppActionBinding,
    recordNativeChainReleasesMock,
    registerReleasedStripReportSinkMock,
} = vi.hoisted(() => {
    const noop = vi.fn();
    const sentinelHandlers = (moduleId: string) => vi.fn<() => HandlerMapSentinel>(() => ({ moduleId }));
    const executableAppActionGroundingCatalog = [{ actionType: 'addMarker', intentPhrases: [] }];
    return {
        noop,
        sentinelHandlers,
        assertCanonicalLlmActionStrategiesMock: vi.fn(),
        getExecutableAppActionGroundingCatalogMock: vi.fn(() => executableAppActionGroundingCatalog),
        executableAppActionGroundingCatalog,
        registerProductionCommandHandlersMock: vi.fn<(maps: HandlerMapSentinel[]) => void>(),
        configureCommandBatchIdempotencyMock: vi.fn(),
        canExecuteCommandBatchMock: vi.fn(() => true),
        configureCollaborationAssetOwnerMock: vi.fn(),
        configureDurableAssetCommitProofMock: vi.fn<(provider: DurableAssetCommitProofProvider) => void>(),
        getAssetTransferMock: vi.fn<() => AssetTransferMock | null>(() => ({
            resumeDurableOwnerRebindsAfterProjectLoad: vi.fn(() => Promise.resolve()),
        })),
        getDurableProjectOwnerIdMock: vi.fn(() => 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa'),
        getVersionedCommandBatchCommitDispositionMock: vi.fn<DurableAssetCommitProofProvider['getDisposition']>(() =>
            Promise.resolve('committed')
        ),
        initBrowserAiMock: vi.fn(() => Promise.resolve()),
        initRaveModelsMock: vi.fn(() => Promise.resolve()),
        registerGlobalErrorHandlersMock: vi.fn(() => vi.fn()),
        eventBusMock: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setWriters: vi.fn() },
        actionHistoryStoreMock: { value: { entries: [] as unknown[] }, subscribe: vi.fn() },
        trackStoreMock: { subscribe: vi.fn() },
        setTimeOperationDependenciesMock: vi.fn(),
        setVcaRuntimeProjectionDependenciesMock: vi.fn(),
        reconcileVcaRuntimeGainMock: vi.fn(),
        prepareAutomationTimeOperationMock: vi.fn(),
        prepareAutomationTimeStateRestoreMock: vi.fn(),
        prepareMidiGlobalTimeTransactionMock: vi.fn(),
        prepareMidiTimeStateRestoreMock: vi.fn(),
        prepareTimelineMapTimeOperationMock: vi.fn(),
        prepareTimelineMapStateRestoreMock: vi.fn(),
        configureAudioDeviceRuntimeSinkMock: vi.fn<(sink: RuntimeSinkUnderTest) => void>(),
        prepareOfflineLevainMock: vi.fn(() => Promise.resolve()),
        initBranchStateMock: vi.fn(),
        recoverInterruptedAgentRunsMock: vi.fn<() => Promise<{ recoveredRunIds: string[] }>>(() =>
            Promise.resolve({ recoveredRunIds: [] })
        ),
        recoverRetainedSectionRenderEffectsMock: vi.fn(() => Promise.resolve()),
        flushDeferredStorageNoticeMock: vi.fn(),
        getAutomationParameterRangeMock: vi.fn(),
        setAutomationParameterRangeResolverMock: vi.fn(),
        // Distinguishable from the shared noop on purpose: the learned-controls
        // registration assertion pins these by reference, so rewiring bootstrap
        // to another barrel's exports has to change what reaches that call.
        setTrackGainMock: vi.fn(),
        // Same distinction for the Toaster groove executor wiring: its assertion
        // pins the registered dispatcher by reference against the barrel binding.
        toasterGrooveExecutorMock: vi.fn(),
        executeUserAppActionBinding: vi.fn(),
        setTrackPanMock: vi.fn(),
        setMidiLearnDependenciesMock: vi.fn(),
        registerCrdtStorageRuntimeMock: vi.fn<() => void>(),
        captureProjectIdentityMock: vi.fn<() => string>(() => 'identity-1'),
        captureProjectRevisionMock: vi.fn<() => string>(() => 'revision-1'),
        projectRevisionMatchesLiveIgnoringCommandCheckpointMock: vi.fn<(expectedRevision: string) => boolean>(
            () => true
        ),
        agentProjectInspectionSetProviderMock: vi.fn(),
        setArrangementEventBusMock: vi.fn<(eventBus: ArrangementEventBus) => void>(),
        setProjectIdentityTransitionDependenciesMock:
            vi.fn<(dependencies: ProjectIdentityTransitionDependencies) => void>(),
        configureRuntimeGraphProjectRevisionValidatorMock:
            vi.fn<(validator: RuntimeGraphProjectRevisionValidator | null) => void>(),
        configureRuntimeGraphTopologyValidatorMock: vi.fn<(validator: RuntimeGraphTopologyValidator | null) => void>(),
        runtimeGraphTopologyMock: {
            matchesCurrentProject: vi.fn<RuntimeGraphTopologyValidator>(),
        },
        setNotificationEventBusMock: vi.fn<(eventBus: NotificationEventBus) => void>(),
        commandRuntimeRepairPortMock: { setProvider: vi.fn() },
        repairRuntimeGraphFromProjectMock: vi.fn(() => Promise.resolve()),
        sessionUndoWitnessStampPortMock: { setProvider: vi.fn() },
        stampSessionUndoWitnessMock: vi.fn(),
        composeGrandBouleMock: vi.fn(),
        // Distinguishable from the shared noop for the same reason as the
        // Toaster and MIDI-learn bindings above: the sink-wiring assertion
        // pins this exact reference, so registering some other function in
        // its place — or dropping the registration outright — fails here.
        recordNativeChainReleasesMock: vi.fn(),
        registerReleasedStripReportSinkMock: vi.fn<(sink: (reports: readonly unknown[]) => void) => void>(),
    };
});

vi.mock('#/infra/logger/runtimeLogger', () => ({ setRuntimeLogger: noop }));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    getGenerationHandlers: sentinelHandlers('AiGeneration'),
    getAiMidiHandlers: sentinelHandlers('AiMidi'),
    // One stub per published descriptor: the registry refuses a map that does not cover the
    // contract, so this stands in for the real generators without pulling their graph in.
    MIDI_TRANSFORM_IMPLEMENTATIONS: Object.fromEntries(getMidiTransformNames().map((name) => [name, () => []])),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    assertCanonicalLlmActionStrategies: assertCanonicalLlmActionStrategiesMock,
    beginMixAnalysis: noop,
    completeMixAnalysis: noop,
    failMixAnalysis: noop,
    recoverInterruptedAgentRuns: recoverInterruptedAgentRunsMock,
    recoverRetainedSectionRenderEffects: recoverRetainedSectionRenderEffectsMock,
    getProjectContext: noop,
    getAiOrganizationHandlers: sentinelHandlers('AiOrganization'),
    initializeVoiceInputAvailability: noop,
    setVoiceToggleEventBus: noop,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: noop,
    resolveEligibleDeviceWriteTarget: noop,
    trackStore: trackStoreMock,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    acceptsExternalPluginAutomationParameter: noop,
    clampDeviceParameterValue: noop,
    clampExternalPluginAutomationValue: noop,
    isDeviceParameterAutomatable: noop,
    quantiseDeviceParameterValue: noop,
    getDeviceContractVersionForCommand: () => 'descriptor-v1:test',
    getDeviceTypesForCommandDeviceIds: () => ({}),
    reserveNextTrackColorForCommand: () => 'oklch(0.40 0.08 250)',
    getAllTracks: noop,
    getAutomationParameterRange: getAutomationParameterRangeMock,
    getPluginById: noop,
    persistDevicePatch: noop,
    cleanupUnusedFreezeFiles: noop,
    setTrackGain: setTrackGainMock,
    setTrackPan: setTrackPanMock,
    setDeviceParameter: noop,
    getArrangementHandlers: sentinelHandlers('Arrangement'),
    initStalenessDetection: noop,
    setArrangementEventBus: setArrangementEventBusMock,
    setOfflineRenderDependencies: noop,
    setTimeOperationDependencies: setTimeOperationDependenciesMock,
    setVcaRuntimeProjectionDependencies: setVcaRuntimeProjectionDependenciesMock,
    getSongStructureHandlers: sentinelHandlers('SongStructure'),
    runtimeGraphTopology: runtimeGraphTopologyMock,
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    getAnalysisHandlers: sentinelHandlers('AudioAnalysis'),
    setMixAnalysisDisplayLifecycle: noop,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: noop,
    updateDevicePatch: noop,
    getAudioContext: noop,
    getCompensationDelay: noop,
    getFinalFeatureHandlers: sentinelHandlers('FinalFeature'),
    commitPitchEdit: noop,
    configureAudioDeviceRuntimeSink: configureAudioDeviceRuntimeSinkMock,
    configureOfflineDeviceParameterLaw: noop,
    configureOfflineMidiEventProjection: noop,
    configureOfflinePpqEndpointProjection: noop,
    configureOfflineYeastMidiProcessing: noop,
    stopAllScheduled: noop,
    compileAudioGraphTopology: noop,
    configureRuntimeGraphProjectRevisionValidator: configureRuntimeGraphProjectRevisionValidatorMock,
    configureRuntimeGraphTopologyValidator: configureRuntimeGraphTopologyValidatorMock,
    recordNativeChainReleases: recordNativeChainReleasesMock,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: () => false },
}));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getAudioRenderingHandlers: sentinelHandlers('AudioRendering'),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationHandlers: sentinelHandlers('Automation'),
    getAutomationValueAtBeat: () => null,
    prepareAutomationTimeOperation: prepareAutomationTimeOperationMock,
    prepareAutomationTimeStateRestore: prepareAutomationTimeStateRestoreMock,
    recordAutomationValue: noop,
    setAutomationRecordingDependencies: noop,
    setAutomationParameterRangeResolver: setAutomationParameterRangeResolverMock,
    setModulationDependencies: noop,
}));

vi.mock('#/modules/Bacteria/stores', () => ({ updateBacteriaMeters: noop }));

vi.mock('#/modules/BrowserAi/useCases', () => ({
    initBrowserAi: initBrowserAiMock,
    initRaveModels: initRaveModelsMock,
    getRaveHandlers: sentinelHandlers('Rave'),
}));

vi.mock('#/modules/Collaboration/useCases', () => ({
    canExecuteCommandBatch: canExecuteCommandBatchMock,
    canMutateBranchMetadata: () => true,
    configureCollaborationAssetOwner: configureCollaborationAssetOwnerMock,
    configureDurableAssetCommitProof: configureDurableAssetCommitProofMock,
    getCollaborationHandlers: sentinelHandlers('Collaboration'),
    getAssetTransfer: getAssetTransferMock,
    leaveSession: noop,
}));

vi.mock('#/modules/Command/useCases', () => ({
    commandBatchPreflightPort: { setProvider: noop },
    commandBatchPreviewPort: { setProvider: noop, setRecoveryProvider: noop },
    configureCommandBatchIdempotency: configureCommandBatchIdempotencyMock,
    commandProjectDivergencePort: { setProvider: noop },
    executeAppAction: noop,
    executeUserAppAction: executeUserAppActionBinding,
    getExecutableAppActionGroundingCatalog: getExecutableAppActionGroundingCatalogMock,
    getVersionedCommandBatchCommitDisposition: getVersionedCommandBatchCommitDispositionMock,
    registerProductionCommandHandlers: registerProductionCommandHandlersMock,
    getMacroHandlers: sentinelHandlers('Macro'),
    getUndoRedoHandlers: sentinelHandlers('UndoRedo'),
    getUndoTreeHandlers: sentinelHandlers('UndoTree'),
    productionBriefAdmissionPort: {
        capture: () => ({ allowsCurrent: () => true }),
        setGuard: noop,
    },
    setActionHistoryMetadataPort: noop,
    commandProjectRevisionPort: { setProvider: noop, setLiveMatchIgnoringCommandCheckpoint: noop },
    commandDeviceVersionsPort: { setDeviceTypeResolver: noop, setResolver: noop },
    commandTrackDefaultsPort: { setTrackColorProvider: noop },
    commandRuntimeRepairPort: commandRuntimeRepairPortMock,
    setCommandEventBus: noop,
    syncActionReplayMetadata: noop,
    captureCommandTargetFingerprints: noop,
    stampSessionUndoWitness: stampSessionUndoWitnessMock,
}));

vi.mock('#/modules/ControlRoom/useCases', () => ({
    getControlRoomHandlers: sentinelHandlers('ControlRoom'),
}));

vi.mock('#/modules/ControlSurface/useCases', () => ({
    getControlSurfaceHandlers: sentinelHandlers('ControlSurface'),
    setMidiLearnDependencies: setMidiLearnDependenciesMock,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    actionHistoryStore: actionHistoryStoreMock,
    agentProjectRepairStateStore: { value: null, subscribe: vi.fn() },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    DOC_PREFIX_ROOT: 'root',
    agentProjectInspectionPort: { setProvider: agentProjectInspectionSetProviderMock },
    captureProjectIdentity: captureProjectIdentityMock,
    captureProjectRevision: captureProjectRevisionMock,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: projectRevisionMatchesLiveIgnoringCommandCheckpointMock,
    createCommandPreviewWorkspace: noop,
    createCommandRecoveryWorkspace: noop,
    getCrdtDoc: noop,
    getDrumPreviewBranchHandlers: sentinelHandlers('DrumPreviewBranch'),
    initBranchState: initBranchStateMock,
    inspectAgentProjectDivergence: noop,
    markActionHistoryEntryReverted: noop,
    recordActionHistoryEntry: noop,
    recordActionHistoryEntries: noop,
    clearActionHistory: noop,
    registerCrdtStorageRuntime: registerCrdtStorageRuntimeMock,
    sessionUndoWitnessStampPort: sessionUndoWitnessStampPortMock,
}));

vi.mock('#/modules/DawInterchange/useCases', () => ({
    getDawProjectHandlers: sentinelHandlers('DawProject'),
}));

vi.mock('#/modules/Fermenter/stores', () => ({ setFermenterTelemetry: noop }));

vi.mock('#/modules/Fermenter/useCases', () => ({
    setFermenterMappedParam: noop,
    setFermenterDependencies: noop,
}));

vi.mock('#/modules/Gluten/stores', () => ({
    updateGlutenMeters: noop,
    deleteGlutenMeters: noop,
}));

vi.mock('#/modules/GrandBoule/useCases', () => ({
    getGrandBouleHandlers: sentinelHandlers('GrandBoule'),
    prepareOfflineGrandBoule: noop,
}));

vi.mock('#/modules/Grinder/stores', () => ({ updateGrinderTelemetry: noop }));

vi.mock('#/modules/Knead/useCases', () => ({
    getPitchHandlers: sentinelHandlers('Pitch'),
    setPitchEditDependencies: noop,
}));

vi.mock('#/modules/Levain/stores', () => ({ setEngineReady: noop }));

vi.mock('#/modules/Levain/useCases', () => ({
    initLevainDeviceStatePersistence: () => noop,
    registerLevainDevice: noop,
    unregisterLevainDevice: noop,
    prepareOfflineLevain: prepareOfflineLevainMock,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getChordTrackHandlers: sentinelHandlers('ChordTrack'),
    getMidiGrooveHandlers: sentinelHandlers('MidiGroove'),
    getMidiNoteTransformHandlers: sentinelHandlers('MidiNoteTransform'),
    getPatternInstanceHandlers: sentinelHandlers('PatternInstance'),
    prepareMidiGlobalTimeTransaction: prepareMidiGlobalTimeTransactionMock,
    prepareMidiTimeStateRestore: prepareMidiTimeStateRestoreMock,
    createChordPitchProjector: noop,
    createGrooveMidiEventProjector: noop,
    resolveMidiNoteArticulationId: () => null,
    shouldPlayMidiEvent: () => true,
    setWebMidiRealtimeProcessor: noop,
    setWebMidiRuntimeEventBus: noop,
    getWebMidiInputHandlers: sentinelHandlers('WebMidiInput'),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    getExternalPluginContractVersionForCommand: () => 'external-plugin-v1:test',
    getPluginHostHandlers: sentinelHandlers('PluginHost'),
    registerReleasedStripReportSink: registerReleasedStripReportSinkMock,
}));

vi.mock('#/modules/Project/useCases', () => ({
    productionBriefActionBatchAdmission: { capture: () => ({ allowsCurrent: () => true }) },
    getProjectHandlers: sentinelHandlers('Project'),
    initGrooveTemplateDirtyTracking: noop,
    initPluginStateDirtyTracking: noop,
    initProjectDirtyTracking: noop,
    migrateLegacyProjectSnapshots: () =>
        Promise.resolve({
            inspected: 0,
            recovered: 0,
            supersededByPrimary: 0,
            mirrorsWithoutPrimary: 0,
            failed: 0,
        }),
    getDurableProjectOwnerId: getDurableProjectOwnerIdMock,
    setProjectIdentityTransitionDependencies: setProjectIdentityTransitionDependenciesMock,
}));

vi.mock('#/modules/Project/stores', () => ({
    getSettledProjectId: getDurableProjectOwnerIdMock,
}));

vi.mock('#/modules/ProjectVersioning/useCases', () => ({
    getVersionControlHandlers: sentinelHandlers('VersionControl'),
}));

vi.mock('#/modules/Proof/stores', () => ({ updateProofMeters: noop, clearProofMeters: noop }));

vi.mock('#/modules/Proof/useCases', () => ({
    registerProofDevice: noop,
    unregisterProofDevice: noop,
    syncFullPatch: noop,
    prepareOfflineProof: noop,
}));

vi.mock('#/modules/PunchRecording/useCases', () => ({
    getPunchRecordingHandlers: sentinelHandlers('PunchRecording'),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    getNodeViewHandlers: sentinelHandlers('NodeView'),
}));

vi.mock('#/modules/SessionLauncher/useCases', () => ({
    getSessionLauncherHandlers: sentinelHandlers('SessionLauncher'),
}));

vi.mock('#/modules/Setlist/useCases', () => ({
    getSetlistHandlers: sentinelHandlers('Setlist'),
    setSetlistEventBus: noop,
}));

vi.mock('#/modules/Toaster/useCases', () => ({
    initToasterSubscribers: noop,
    initToasterKitPersistence: noop,
    setToasterEventBus: noop,
    setToasterGrooveAssignmentExecutor: toasterGrooveExecutorMock,
    prepareOfflineToaster: noop,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportHandlers: sentinelHandlers('Transport'),
    getTransportState: noop,
    createMusicalPositionProjector: noop,
    createSamplePositionProjector: noop,
    projectPpqEndpoints: noop,
    resolveTempoAtBeat: noop,
    prepareTimelineMapTimeOperation: prepareTimelineMapTimeOperationMock,
    prepareTimelineMapStateRestore: prepareTimelineMapStateRestoreMock,
    setStopPlaybackCallback: noop,
    reconcileVcaRuntimeGain: reconcileVcaRuntimeGainMock,
    stopPlayback: noop,
    repairRuntimeGraphFromProject: repairRuntimeGraphFromProjectMock,
}));

vi.mock('#/modules/Tuner/stores', () => ({ updateTunerTelemetry: noop }));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    getWorkspaceHandlers: sentinelHandlers('Workspace'),
    getScratchPadHandlers: sentinelHandlers('ScratchPad'),
    setWorkspaceEventBus: noop,
}));

vi.mock('#/modules/Yeast/stores', () => ({ setYeastEventBus: noop }));

vi.mock('#/modules/Yeast/useCases', () => ({
    configureYeastRuntime: noop,
    createOfflineYeastMidiProcessor: noop,
    processRealtimeMidiInput: noop,
    teardownYeastRuntime: noop,
}));

vi.mock('#/utils/capabilities', () => ({ logCapabilities: noop }));

vi.mock('#/utils/Notification/notificationEventBus', () => ({
    setNotificationEventBus: setNotificationEventBusMock,
    // `storageFullNotice` reaches this module through `notifyUser`, whose
    // `inject` call needs the token at import time.
    NotificationEventBus: class {},
}));

vi.mock('#/infra/store/storage/storageFullNotice', () => ({
    flushDeferredStorageNotice: flushDeferredStorageNoticeMock,
}));

vi.mock('../registerDependencies', () => ({
    eventBus: eventBusMock,
    logger: loggerMock,
}));

vi.mock('../registerGlobalErrorHandlers', () => ({
    registerGlobalErrorHandlers: registerGlobalErrorHandlersMock,
}));

vi.mock('../composeGrandBoule', () => ({
    composeGrandBoule: composeGrandBouleMock,
}));

// Side-effect import: this is what runs the composition root under test.
// `vi.mock` calls above are hoisted above this import by Vitest, so every
// dependency bootstrap.ts pulls in is already mocked by the time it runs.
import '../bootstrap';

const raveModelBootCalls = [...initRaveModelsMock.mock.calls];

function getDurableAssetOwnerRecoveryAfterProjectLoad(): DurableAssetOwnerRecoveryAfterProjectLoad {
    const dependencyCall = setProjectIdentityTransitionDependenciesMock.mock.calls.at(0);
    if (!dependencyCall) {
        throw new Error('bootstrap never configured project identity transition dependencies');
    }
    const [dependencies] = dependencyCall;
    const recovery = dependencies.resumeDurableAssetOwnerHandoffsAfterProjectLoad;
    if (!recovery) {
        throw new Error('bootstrap never configured durable asset owner recovery after project load');
    }
    return recovery;
}

describe('bootstrap', () => {
    // The exact order bootstrap.ts passes module handler maps to the production assembler.
    // This list IS the assertion: every module bootstrap wires into the shared
    // handler registry must appear here
    // exactly once, in registration order — proving the wiring is both complete
    // (nothing missing) and idempotent (nothing registered twice).
    const expectedRegistrationOrder = [
        'Arrangement',
        'Transport',
        'SessionLauncher',
        'Setlist',
        'PunchRecording',
        'Workspace',
        'Automation',
        'AudioRendering',
        'AiGeneration',
        'AudioAnalysis',
        'Collaboration',
        'PluginHost',
        'AiMidi',
        'AiOrganization',
        'ChordTrack',
        'MidiNoteTransform',
        'DrumPreviewBranch',
        'MidiGroove',
        'ControlSurface',
        'ScratchPad',
        'PatternInstance',
        'Macro',
        'UndoRedo',
        'UndoTree',
        'Pitch',
        'SongStructure',
        'Project',
        'VersionControl',
        'DawProject',
        'FinalFeature',
        'GrandBoule',
        'NodeView',
        'WebMidiInput',
        'Rave',
        'ControlRoom',
    ];

    it('validates LLM strategy names against the command catalogue before handler registration', () => {
        expect(getExecutableAppActionGroundingCatalogMock).toHaveBeenCalledExactlyOnceWith();
        expect(assertCanonicalLlmActionStrategiesMock).toHaveBeenCalledExactlyOnceWith(
            executableAppActionGroundingCatalog
        );
        expect(assertCanonicalLlmActionStrategiesMock.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
            registerProductionCommandHandlersMock.mock.invocationCallOrder[0] ?? Infinity
        );
    });

    it('registers every module handler map exactly once, in bootstrap wiring order', () => {
        const registeredModuleIds = registerProductionCommandHandlersMock.mock.calls[0]?.[0].map(
            (handlerMap) => handlerMap.moduleId
        );

        expect(registerProductionCommandHandlersMock).toHaveBeenCalledTimes(1);
        expect(registeredModuleIds).toEqual(expectedRegistrationOrder);
    });

    it('registers a complete, duplicate-free set of handler maps', () => {
        const registeredModuleIds = registerProductionCommandHandlersMock.mock.calls[0]?.[0].map(
            (handlerMap) => handlerMap.moduleId
        );
        expect(registeredModuleIds).toHaveLength(expectedRegistrationOrder.length);
        expect(new Set(registeredModuleIds).size).toBe(expectedRegistrationOrder.length);
    });

    it('wires global error handlers to the app runtime logger', () => {
        expect(registerGlobalErrorHandlersMock).toHaveBeenCalledExactlyOnceWith({ logger: loggerMock });
    });

    it('configures durable command-batch idempotency exactly once', () => {
        expect(configureCommandBatchIdempotencyMock).toHaveBeenCalledExactlyOnceWith({
            canExecute: canExecuteCommandBatchMock,
        });
    });
    it('wires the Toaster groove executor to the user dispatch wrapper', async () => {
        // Identity pin: the executor ToasterPanel gestures flow through must be
        // the barrel's executeUserAppAction binding, so an admission refusal on
        // a groove assignment reaches the user as a notification. Rewiring to
        // the bare executeAppAction changes the reference and fails this test.
        const registered = toasterGrooveExecutorMock.mock.calls[0]?.[0];
        expect(registered).toBeDefined();
        const { executeUserAppAction } = await import('#/modules/Command/useCases');
        expect(registered?.execute).toBe(executeUserAppAction);
    });

    it('gives Collaboration only Project-owned settled identity reads', () => {
        expect(configureCollaborationAssetOwnerMock).toHaveBeenCalledExactlyOnceWith({
            captureOwnerId: getDurableProjectOwnerIdMock,
        });
    });

    it('resumes durable owner handoffs only through the persisted-project load seam', async () => {
        const resumeDurableAssetOwnerHandoffsAfterProjectLoad = getDurableAssetOwnerRecoveryAfterProjectLoad();
        const authority = {
            ownerId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            isCurrent: () => true,
            signal: new AbortController().signal,
        };

        await resumeDurableAssetOwnerHandoffsAfterProjectLoad(authority);

        expect(getAssetTransferMock).toHaveBeenCalledOnce();
        const assetTransferResult = getAssetTransferMock.mock.results[0];
        if (!assetTransferResult?.value) {
            throw new Error('bootstrap did not resolve an asset transfer');
        }
        expect(assetTransferResult.value.resumeDurableOwnerRebindsAfterProjectLoad).toHaveBeenCalledExactlyOnceWith({
            ownerId: authority.ownerId,
            isCurrent: expect.any(Function),
            signal: authority.signal,
        });
    });

    it('does not resolve or recover an asset owner after project-load authority is stale', async () => {
        const resumeDurableAssetOwnerHandoffsAfterProjectLoad = getDurableAssetOwnerRecoveryAfterProjectLoad();
        const callsBeforeStaleRecovery = getAssetTransferMock.mock.calls.length;

        await resumeDurableAssetOwnerHandoffsAfterProjectLoad({
            ownerId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            isCurrent: () => false,
            signal: new AbortController().signal,
        });

        expect(getAssetTransferMock).toHaveBeenCalledTimes(callsBeforeStaleRecovery);
    });

    it('fails closed when durable asset recovery is unavailable after a current project load', async () => {
        const resumeDurableAssetOwnerHandoffsAfterProjectLoad = getDurableAssetOwnerRecoveryAfterProjectLoad();
        getAssetTransferMock.mockReturnValueOnce(null);

        await expect(
            resumeDurableAssetOwnerHandoffsAfterProjectLoad({
                ownerId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
                isCurrent: () => true,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Durable asset owner recovery is unavailable after project load');
    });

    it('binds durable asset admission to the exact Command commit proof', async () => {
        expect(configureDurableAssetCommitProofMock).toHaveBeenCalledExactlyOnceWith({
            getDisposition: getVersionedCommandBatchCommitDispositionMock,
        });
        const provider = configureDurableAssetCommitProofMock.mock.calls[0]?.[0];
        if (!provider) {
            throw new Error('bootstrap did not configure durable asset commit proof');
        }
        const proof = {
            projectId: 'project-bootstrap-proof',
            idempotencyKey: 'request-bootstrap-proof',
            contentHash: `sha256:${'a'.repeat(64)}`,
            runId: 'run-bootstrap-proof',
            batchId: 'batch-bootstrap-proof',
            baseRevision: 'project-revision-before-bootstrap-proof',
            commands: [
                { commandId: '11111111-1111-4111-8111-111111111111', operation: 'importStemSet' },
                { commandId: '22222222-2222-4222-8222-222222222222', operation: 'setTrackGain' },
            ],
        };

        await expect(provider.getDisposition(proof)).resolves.toBe('committed');
        expect(getVersionedCommandBatchCommitDispositionMock).toHaveBeenCalledExactlyOnceWith(proof);
    });

    it('wires project runtime validation and event buses in the composition root', () => {
        expect(registerCrdtStorageRuntimeMock).toHaveBeenCalledExactlyOnceWith();
        expect(agentProjectInspectionSetProviderMock).toHaveBeenCalledExactlyOnceWith(
            captureAgentProjectInspectionState
        );
        expect(setArrangementEventBusMock).toHaveBeenCalledExactlyOnceWith(eventBusMock);

        expect(configureRuntimeGraphProjectRevisionValidatorMock).toHaveBeenCalledTimes(1);
        const projectRevisionValidatorCall = configureRuntimeGraphProjectRevisionValidatorMock.mock.calls.at(0);
        if (!projectRevisionValidatorCall) {
            throw new Error('bootstrap never configured the runtime graph project revision validator');
        }
        const [projectRevisionValidator] = projectRevisionValidatorCall;
        if (!projectRevisionValidator) {
            throw new Error('bootstrap configured an empty runtime graph project revision validator');
        }
        captureProjectRevisionMock.mockReturnValue('revision-1');
        expect(projectRevisionValidator('revision-1')).toBe(true);
        captureProjectRevisionMock.mockReturnValue('revision-2');
        expect(projectRevisionValidator('revision-1')).toBe(false);
        expect(captureProjectRevisionMock).toHaveBeenCalledTimes(2);

        expect(configureRuntimeGraphTopologyValidatorMock).toHaveBeenCalledExactlyOnceWith(
            runtimeGraphTopologyMock.matchesCurrentProject
        );
        expect(setNotificationEventBusMock).toHaveBeenCalledExactlyOnceWith(eventBusMock);
    });

    it('registers the exact forward and restore global-time owner preparations', () => {
        expect(setTimeOperationDependenciesMock).toHaveBeenCalledExactlyOnceWith({
            prepareAutomationTimeOperation: prepareAutomationTimeOperationMock,
            prepareAutomationTimeStateRestore: prepareAutomationTimeStateRestoreMock,
            prepareMidiGlobalTimeTransaction: prepareMidiGlobalTimeTransactionMock,
            prepareMidiTimeStateRestore: prepareMidiTimeStateRestoreMock,
            prepareTimelineMapTimeOperation: prepareTimelineMapTimeOperationMock,
            prepareTimelineMapStateRestore: prepareTimelineMapStateRestoreMock,
        });
    });

    it('wires VCA runtime projection through the composition root', () => {
        expect(setVcaRuntimeProjectionDependenciesMock).toHaveBeenCalledExactlyOnceWith({
            reconcileVcaRuntimeGain: reconcileVcaRuntimeGainMock,
        });
    });

    it('wires command recovery to the awaited runtime graph repair owner', () => {
        expect(commandRuntimeRepairPortMock.setProvider).toHaveBeenCalledExactlyOnceWith(
            repairRuntimeGraphFromProjectMock
        );
    });

    it('wires the undo session witness stamp port to the real production stamp (#3331)', () => {
        expect(sessionUndoWitnessStampPortMock.setProvider).toHaveBeenCalledExactlyOnceWith(
            stampSessionUndoWitnessMock
        );
    });

    it('composes Grand Boule with the shared event bus and logger', () => {
        expect(composeGrandBouleMock).toHaveBeenCalledExactlyOnceWith({
            eventBus: eventBusMock,
            logger: loggerMock,
        });
    });

    it('wires Automation lane ranges to Arrangement descriptor truth', () => {
        expect(setAutomationParameterRangeResolverMock).toHaveBeenCalledExactlyOnceWith(
            getAutomationParameterRangeMock
        );
    });

    /**
     * An unload changes native strip state with no batch of its own to carry
     * it, so PluginHost's own release reports have no route to AudioEngine's
     * session mirror except the sink the composition root wires here (#3793).
     * Pinned by reference, like the Toaster and MIDI-learn bindings above:
     * registering some other function, or dropping the registration outright,
     * leaves an unload's released strips with nowhere to narrow the mirror.
     */
    it('wires an unload plugin release report to narrow the native chain session AudioEngine holds', () => {
        expect(registerReleasedStripReportSinkMock).toHaveBeenCalledExactlyOnceWith(recordNativeChainReleasesMock);
    });

    /**
     * The `handleMidiMessage` suite proves injected setters reach the store and
     * the engine, but it injects its own stand-ins, so nothing there can tell
     * which functions production hands in. This is the only seam that observes
     * what bootstrap registers: Arrangement's barrel exports `setTrackGain` and
     * `setTrackPan` as dedicated hoisted stand-ins (not the shared `noop`, which
     * other barrels also export), so pinning them by reference makes deleting or
     * rewiring the bootstrap call fail here instead of at the first learned MIDI
     * message.
     */
    it('wires learned MIDI controls to Arrangement gain and pan setters', () => {
        expect(setMidiLearnDependenciesMock).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                setTrackGainArrangement: setTrackGainMock,
                setTrackPanArrangement: setTrackPanMock,
            })
        );
    });

    describe('offline instrument setup dispatch', () => {
        // The offline device chain hands every worklet-backed device to this sink
        // member; bootstrap is the only place that knows which device types have
        // anything to prepare. Until this spec named `prepareOfflineLevain` in the
        // Levain mock, the binding bootstrap closed over was `undefined` here and
        // nothing noticed.
        function getSink(): RuntimeSinkUnderTest {
            const call = configureAudioDeviceRuntimeSinkMock.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never configured the audio device runtime sink');
            }
            return call[0];
        }

        const port = { postMessage: () => {} } as unknown as MessagePort;

        it('routes a levain device to the Levain module, passing its id, port and signal', async () => {
            prepareOfflineLevainMock.mockClear();
            const controller = new AbortController();

            await getSink().prepareOfflineInstrument({
                deviceId: 'levain-1',
                deviceType: 'levain',
                port,
                signal: controller.signal,
            });

            expect(prepareOfflineLevainMock).toHaveBeenCalledExactlyOnceWith({
                deviceId: 'levain-1',
                port,
                signal: controller.signal,
            });
        });

        it('resolves without preparing anything for a device type that owns no offline setup', async () => {
            prepareOfflineLevainMock.mockClear();

            // Gluten is a bus compressor: worklet-backed, but nothing to load.
            await expect(
                getSink().prepareOfflineInstrument({ deviceId: 'gluten-1', deviceType: 'gluten', port })
            ).resolves.toBeUndefined();
            expect(prepareOfflineLevainMock).not.toHaveBeenCalled();
        });
    });

    it('kicks off browser AI initialization exactly once as a non-blocking boot step', () => {
        // initBrowserAi() is fire-and-forget (`.catch(...)`, no await) — assert
        // it was invoked rather than that bootstrap awaits or returns it.
        expect(initBrowserAiMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('flushes any storage notice held from before the notification bus existed', () => {
        // Storage adapters cannot resolve `notifyUser` before the bus is
        // registered: `inject` caches the closure it builds on first call, and
        // an unregistered token resolves to the abstract class rather than
        // throwing, so one pre-bootstrap call would break every `notifyUser`
        // site for the life of the page. See #1557.
        expect(flushDeferredStorageNoticeMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('recovers the pre-session branch state as an explicit boot step', () => {
        // It used to be a side effect of evaluating branchStore.ts, where a
        // refused localStorage write threw during module evaluation and stopped
        // the app booting with no catch anywhere able to reach it. See #1557.
        expect(initBranchStateMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('recovers interrupted AI runs as an explicit boot step', () => {
        expect(recoverInterruptedAgentRunsMock).toHaveBeenCalledExactlyOnceWith();
        expect(recoverRetainedSectionRenderEffectsMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('waits for interrupted-run recovery and skips retained renders when that recovery rejects', async () => {
        recoverInterruptedAgentRunsMock.mockClear();
        recoverRetainedSectionRenderEffectsMock.mockClear();
        loggerMock.error.mockClear();
        let resolveInterruptedRecovery!: (value: { recoveredRunIds: string[] }) => void;
        const interruptedRecovery = new Promise<{ recoveredRunIds: string[] }>((resolve) => {
            resolveInterruptedRecovery = resolve;
        });
        recoverInterruptedAgentRunsMock.mockImplementationOnce(() => interruptedRecovery);

        vi.resetModules();
        await import('../bootstrap');

        expect(recoverInterruptedAgentRunsMock).toHaveBeenCalledExactlyOnceWith();
        expect(recoverRetainedSectionRenderEffectsMock).not.toHaveBeenCalled();

        resolveInterruptedRecovery({ recoveredRunIds: [] });
        await Promise.resolve();

        expect(recoverRetainedSectionRenderEffectsMock).toHaveBeenCalledExactlyOnceWith();

        recoverInterruptedAgentRunsMock.mockClear();
        recoverRetainedSectionRenderEffectsMock.mockClear();
        loggerMock.error.mockClear();
        recoverInterruptedAgentRunsMock.mockImplementationOnce(() => Promise.reject(new Error('hydration failed')));

        vi.resetModules();
        await import('../bootstrap');
        await Promise.resolve();

        expect(recoverInterruptedAgentRunsMock).toHaveBeenCalledExactlyOnceWith();
        expect(recoverRetainedSectionRenderEffectsMock).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ message: 'Interrupted AI runs could not be recovered during startup' })
        );
    });

    it('registers a MIDI transform implementation for every published transform descriptor', () => {
        // A descriptor the planner can discover but nothing can run would reject the batch at
        // expansion time, after the plan was already proposed.
        const names = getMidiTransformNames();
        expect(names.length).toBeGreaterThan(0);
        expect(getMidiTransformDescriptors().map((descriptor) => descriptor.name)).toEqual([...names]);
        expect(names.filter((name) => getMidiTransform(name) === undefined)).toEqual([]);
    });

    it('probes OPFS for RAVE model weights exactly once as a non-blocking boot step', () => {
        // Without this call raveStore.models stays empty forever, which would
        // withhold the RAVE palette entries permanently rather than gating them
        // on real model presence.
        expect(raveModelBootCalls).toEqual([[]]);
    });
});
