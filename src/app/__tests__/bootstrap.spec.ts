import { beforeEach, describe, it, expect, vi } from 'vitest';

import { getMidiTransform, getMidiTransformDescriptors, getMidiTransformNames } from '#/modules/Command/stores';
// The kit chunk the native-device-state assertion reads comes out of Toaster's
// own device-state serializer, not from a hand-written shape: a hand-written one
// could drift from what `fromToasterKitState` accepts and degrade to the default
// kit, which would assert the default gain rather than the stored one. The
// factory kit arrives through the module's contract barrel, which is the only
// door a test outside the module may use.
import { getToasterPresetDeviceState } from '#/modules/Toaster/useCases';

// Vitest hoists the `vi.mock` calls below above every import, so each
// dependency bootstrap.ts pulls in is already mocked when the entry runs.
import { bootstrapApplication } from '../bootstrap';
import { captureAgentProjectInspectionState } from '../captureCommandBatchPreflightState';
import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

import type { setArrangementEventBus } from '#/modules/Arrangement/useCases';
import type {
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import type { setModulationDependencies } from '#/modules/Automation/useCases';
import type { configureDurableAssetCommitProof } from '#/modules/Collaboration/useCases';
import type { resetActionReplayAuthority, syncActionReplayMetadata } from '#/modules/Command/useCases';
import type { subscribeToPublishedActionHistory } from '#/modules/CrdtDocument/useCases';
import type { setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import type { NotificationEventBus } from '#/utils/Notification/notificationEventBus';

const elasticRootMocks = vi.hoisted(() => ({
    install: vi.fn<typeof import('#/modules/ElasticAudio/useCases').setElasticRootIdentityProvider>(),
}));

// Members whose callbacks the composition root builds itself. Each is a distinct
// double so a spec can capture the callback bootstrap registered and observe which
// dependency it forwards to. `beforeUnloadSpy` records the window listeners the
// first boot installs, before any later re-boot adds its own.
const callbackWiring = vi.hoisted(() => {
    const disposeWebMidiRealtimeProcessor = vi.fn<() => void>();
    const disposeGlobalErrorHandlers = vi.fn<() => void>();
    return {
        disposeWebMidiRealtimeProcessor,
        disposeGlobalErrorHandlers,
        setWebMidiRealtimeProcessor: vi.fn(() => disposeWebMidiRealtimeProcessor),
        destroyWebMidi: vi.fn<() => void>(),
        teardownYeastRuntime: vi.fn<() => void>(),
        cleanupUnusedFreezeFiles: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        setCommandDeviceVersionsResolver: vi.fn<(resolver: (deviceType: string) => string | undefined) => void>(),
        getDeviceContractVersionForCommand: vi.fn<(deviceType: string) => string | undefined>(),
        getExternalPluginContractVersionForCommand: vi.fn<(deviceType: string) => string | undefined>(),
        setStopPlaybackCallback: vi.fn<(callback: () => void) => void>(),
        stopPlayback: vi.fn<() => Promise<void>>(),
        getAudioContext: vi.fn<() => { currentTime: number }>(),
        readNativeEngineCursorBeats: vi.fn<() => number | null>(),
        setGestureClockSource:
            vi.fn<
                (source: { getAudioTimeSeconds: () => number; readNativeCursorBeats: () => number | null }) => void
            >(),
        getPluginById: vi.fn(),
        setModulationDependencies: vi.fn<(dependencies: ModulationDependencies) => void>(),
        getTransportState: vi.fn<() => { isPlaying: boolean; playheadPosition: number } | undefined>(),
        registerLevainDevice: vi.fn(),
        setEngineReady: vi.fn<(deviceId: string, isReady: boolean) => void>(),
        prepareCrumbsEngine: vi.fn(),
        captureOfflineLevain: vi.fn(),
        setFermenterTelemetry:
            vi.fn<(deviceId: string, peakL: number, peakR: number, scopeBuffer: Float32Array) => void>(),
        updateCrustMeters: vi.fn<(deviceId: string, meters: Record<string, unknown>) => void>(),
        deleteCrustMeters: vi.fn<(deviceId: string) => void>(),
        updateBacteriaMeters: vi.fn(),
        beforeUnloadSpy: vi.spyOn(window, 'addEventListener'),
    };
});

const briefAdmissionWiring = vi.hoisted(() => ({
    setSubscription: vi.fn<(subscription: (listener: () => void) => () => void) => void>(),
    subscribeToProductionBriefChanges: vi.fn<(listener: () => void) => () => void>(),
}));

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
type ModulationDependencies = Parameters<typeof setModulationDependencies>[0];
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
type PublishedHistoryObserver = Parameters<typeof subscribeToPublishedActionHistory>[0];
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
    projectNativeDeviceState: (input: {
        deviceId: string;
        deviceType: string;
        deviceState: { version: number; data: Record<string, unknown> } | undefined;
    }) => Readonly<Record<string, number>> | null;
    nativeSampleBankKey: (input: {
        deviceType: string;
        deviceState: { version: number; data: Record<string, unknown> } | undefined;
    }) => string | null;
    nativeModAssignments: (input: {
        deviceType: string;
        deviceState: { version: number; data: Record<string, unknown> } | undefined;
    }) => readonly { sourceId: number; targetParam: number; amount: number }[] | null;
    acquireNativeSampleBank: (bankKey: string) => Promise<unknown>;
    nativeBuiltinParameterName: (input: { deviceType: string; paramId: string }) => string | null;
    updateTunerTelemetry: (deviceId: string, telemetry: TunerReadingUnderTest) => void;
    updateNativeTunerTelemetry: (deviceId: string, telemetry: TunerReadingUnderTest) => void;
    emitDeviceLoaded: (payload: Record<string, unknown>) => void;
    emitDeviceRemoved: (payload: Record<string, unknown>) => void;
    registerLevainDevice: (input: {
        deviceId: string;
        device: Record<string, unknown>;
        port: MessagePort;
        onProgress: () => void;
    }) => unknown;
    setLevainEngineReady: (input: { deviceId: string; isReady: boolean }) => void;
    captureOfflineInstrument: (
        device: { id: string; type: string },
        source?: undefined
    ) => (input: { port: MessagePort; signal?: AbortSignal }) => Promise<void>;
    prepareCrumbsDevice: (input: { deviceId: string; port: MessagePort; signal?: AbortSignal }) => Promise<unknown>;
    setFermenterTelemetry: (
        deviceId: string,
        telemetry: { peakL: number; peakR: number; scopeBuffer: Float32Array }
    ) => void;
    updateCrustMeters: (deviceId: string, meters: Record<string, unknown>) => void;
    deleteCrustMeters: (deviceId: string) => void;
    updateBacteriaMeters: (
        deviceId: string,
        meters: { inputDb: number; outputDb: number; bandLevels: number[]; latency: number }
    ) => void;
};

/**
 * The reading both of the Tuner's publishes carry (`TunerTelemetry`,
 * `#/modules/AudioEngine/engine/ScoringNode.ts`), restated here because this
 * spec mocks the whole barrel it would otherwise be imported through.
 */
type TunerReadingUnderTest = {
    active: boolean;
    frequency: number;
    cents: number;
    confidence: number;
    noteIndex: number;
    octave: number;
    midiNote: number;
    noteName: string;
};

const {
    noop,
    configureOfflineMidiProjectionMock,
    configureOfflinePpqProjectionMock,
    beatAtSecondsFromAnchorMock,
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
    subscribeToPublishedActionHistoryMock,
    syncActionReplayMetadataMock,
    resetActionReplayAuthorityMock,
    trackStoreMock,
    setTimeOperationDependenciesMock,
    setVcaRuntimeProjectionDependenciesMock,
    reconcileVcaRuntimeGainMock,
    prepareAutomationTimeOperationMock,
    prepareAutomationTimeStateRestoreMock,
    isValidAutomationTimeStateRestorePlanMock,
    prepareMidiGlobalTimeTransactionMock,
    prepareMidiTimeStateRestoreMock,
    isValidMidiTimeStateRestorePlanMock,
    prepareTimelineMapTimeOperationMock,
    prepareTimelineMapStateRestoreMock,
    isValidTimelineMapStateRestorePlanMock,
    configureAudioDeviceRuntimeSinkMock,
    isTunerTelemetryNativelyOwnedMock,
    updateTunerTelemetryMock,
    canExecuteCommandBatchMock,
    configureCollaborationAssetOwnerMock,
    configureDurableAssetCommitProofMock,
    getAssetTransferMock,
    getDurableProjectOwnerIdMock,
    getVersionedCommandBatchCommitDispositionMock,
    prepareOfflineLevainMock,
    projectLevainDeviceStateToNativePatchMock,
    nativeBankKeyForLevainDeviceStateMock,
    acquireLevainNativeBankMock,
    getLevainEngineParameterNameMock,
    buildLevainZoneTablesMock,
    configureLevainZoneTableBuilderMock,
    initBranchStateMock,
    initGrandBouleDocumentReconciliationMock,
    recoverInterruptedAgentRunsMock,
    recoverRetainedSectionRenderEffectsMock,
    flushDeferredStorageNoticeMock,
    getAutomationParameterRangeMock,
    setAutomationParameterRangeResolverMock,
    setTrackGainMock,
    setTrackPanMock,
    setMidiLearnDependenciesMock,
    registerCrdtStorageRuntimeMock,
    registerProjectSlotProjectionsMock,
    registerProjectLifecycleMock,
    registerDeviceEnginePortsMock,
    registerSupportingServicePortsMock,
    registerKernelPortsMock,
    captureProjectRootIdentityMock,
    setElasticSensitivityRootIdentityCaptureMock,
    captureProjectIdentityMock,
    captureProjectRevisionMock,
    settledProjectRevisionMatchesLiveIgnoringSaveWritesMock,
    agentProjectInspectionSetProviderMock,
    setArrangementEventBusMock,
    setRecordingMidiAdmissionPortMock,
    isRecordingMidiInputExcludedMock,
    configureRuntimeGraphProjectRevisionValidatorMock,
    configureRuntimeGraphTopologyValidatorMock,
    initEngineDeviceCollaboratorsMock,
    runtimeGraphTopologyMock,
    setNotificationEventBusMock,
    setProjectIdentityTransitionDependenciesMock,
    commandRuntimeRepairPortMock,
    commandProjectRevisionPortMock,
    externalClientManifestPortMock,
    repairRuntimeGraphFromProjectMock,
    sessionUndoWitnessStampPortMock,
    stampSessionUndoWitnessMock,
    composeGrandBouleMock,
    toasterGrooveExecutorMock,
    executeUserAppActionBinding,
    recordNativeChainReleasesMock,
    registerReleasedStripReportSinkMock,
    setCrumbsEventBusMock,
    initCrumbsModePushMock,
    initDeviceStateReconciliationMock,
    initTimelineViewReconciliationMock,
    initAudioBufferCacheAccessMock,
    initInputMonitoringProjectAccessMock,
    initLevainDeviceStateProjectAccessMock,
} = vi.hoisted(() => {
    const noop = vi.fn();
    const sentinelHandlers = (moduleId: string) => vi.fn<() => HandlerMapSentinel>(() => ({ moduleId }));
    const executableAppActionGroundingCatalog = [{ actionType: 'addMarker', intentPhrases: [] }];
    return {
        noop,
        configureOfflineMidiProjectionMock: vi.fn<typeof configureOfflineMidiEventProjection>(),
        configureOfflinePpqProjectionMock: vi.fn<typeof configureOfflinePpqEndpointProjection>(),
        beatAtSecondsFromAnchorMock: vi.fn(() => -1),
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
        registerGlobalErrorHandlersMock: vi.fn(() => callbackWiring.disposeGlobalErrorHandlers),
        eventBusMock: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setWriters: vi.fn() },
        actionHistoryStoreMock: { value: { entries: [] as unknown[] }, subscribe: vi.fn() },
        subscribeToPublishedActionHistoryMock: vi.fn<typeof subscribeToPublishedActionHistory>(() => noop),
        syncActionReplayMetadataMock: vi.fn<typeof syncActionReplayMetadata>(),
        resetActionReplayAuthorityMock: vi.fn<typeof resetActionReplayAuthority>(),
        trackStoreMock: { subscribe: vi.fn() },
        setTimeOperationDependenciesMock: vi.fn(),
        setVcaRuntimeProjectionDependenciesMock: vi.fn(),
        reconcileVcaRuntimeGainMock: vi.fn(),
        prepareAutomationTimeOperationMock: vi.fn(),
        prepareAutomationTimeStateRestoreMock: vi.fn(),
        isValidAutomationTimeStateRestorePlanMock: vi.fn(() => false),
        prepareMidiGlobalTimeTransactionMock: vi.fn(),
        prepareMidiTimeStateRestoreMock: vi.fn(),
        isValidMidiTimeStateRestorePlanMock: vi.fn(() => false),
        prepareTimelineMapTimeOperationMock: vi.fn(),
        prepareTimelineMapStateRestoreMock: vi.fn(),
        isValidTimelineMapStateRestorePlanMock: vi.fn(() => false),
        configureAudioDeviceRuntimeSinkMock: vi.fn<(sink: RuntimeSinkUnderTest) => void>(),
        isTunerTelemetryNativelyOwnedMock: vi.fn<(deviceId: string) => boolean>(() => false),
        updateTunerTelemetryMock: vi.fn(),
        prepareOfflineLevainMock: vi.fn(() => Promise.resolve()),
        projectLevainDeviceStateToNativePatchMock: vi.fn<
            (input: { deviceState: unknown }) => Readonly<Record<string, number>> | null
        >(() => ({ current_articulation: 4 })),
        nativeBankKeyForLevainDeviceStateMock: vi.fn<(input: { deviceState: unknown }) => string | null>(
            () => 'levain:violin-1'
        ),
        acquireLevainNativeBankMock: vi.fn(() => Promise.resolve(null)),
        getLevainEngineParameterNameMock: vi.fn<(input: { paramId: string }) => string | null>(({ paramId }) =>
            paramId === 'masterGain' ? 'master_gain' : null
        ),
        // Distinguishable from the shared noop: the Levain builder wiring
        // assertion pins this exact reference.
        buildLevainZoneTablesMock: vi.fn(),
        configureLevainZoneTableBuilderMock: vi.fn(),
        initBranchStateMock: vi.fn(),
        initGrandBouleDocumentReconciliationMock: vi.fn(),
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
        // Distinguishable from the shared noop for the same reason as the
        // durable audio ownership provider above: the assertion pins this
        // exact reference, so rewiring or dropping the registration fails here.
        // Distinguishable from the shared noop like the other seam pins: the
        // Crumbs wiring assertions pin these by reference, so deleting the
        // composition-root registration or handing the seam another function
        // fails here.
        setCrumbsEventBusMock: vi.fn(),
        initCrumbsModePushMock: vi.fn(),
        initDeviceStateReconciliationMock: vi.fn(),
        initTimelineViewReconciliationMock: vi.fn(),
        initAudioBufferCacheAccessMock: vi.fn(),
        initInputMonitoringProjectAccessMock: vi.fn(),
        initLevainDeviceStateProjectAccessMock: vi.fn(),
        setMidiLearnDependenciesMock: vi.fn(),
        registerCrdtStorageRuntimeMock: vi.fn<() => void>(),
        registerProjectSlotProjectionsMock: vi.fn<() => void>(),
        registerProjectLifecycleMock: vi.fn<() => void>(),
        registerDeviceEnginePortsMock: vi.fn<() => void>(),
        registerSupportingServicePortsMock: vi.fn<() => void>(),
        registerKernelPortsMock: vi.fn<() => void>(),
        captureProjectRootIdentityMock: vi.fn<() => string>(() => 'root-identity'),
        setElasticSensitivityRootIdentityCaptureMock: vi.fn(),
        captureProjectIdentityMock: vi.fn<() => string>(() => 'identity-1'),
        captureProjectRevisionMock: vi.fn<() => string>(() => 'revision-1'),
        settledProjectRevisionMatchesLiveIgnoringSaveWritesMock: vi.fn<(expectedRevision: string) => boolean>(
            () => true
        ),
        agentProjectInspectionSetProviderMock: vi.fn(),
        setArrangementEventBusMock: vi.fn<(eventBus: ArrangementEventBus) => void>(),
        setRecordingMidiAdmissionPortMock: vi.fn(),
        isRecordingMidiInputExcludedMock: vi.fn(() => false),
        setProjectIdentityTransitionDependenciesMock:
            vi.fn<(dependencies: ProjectIdentityTransitionDependencies) => void>(),
        configureRuntimeGraphProjectRevisionValidatorMock:
            vi.fn<(validator: RuntimeGraphProjectRevisionValidator | null) => void>(),
        configureRuntimeGraphTopologyValidatorMock: vi.fn<(validator: RuntimeGraphTopologyValidator | null) => void>(),
        initEngineDeviceCollaboratorsMock: vi.fn<() => void>(),
        runtimeGraphTopologyMock: {
            matchesCurrentProject: vi.fn<RuntimeGraphTopologyValidator>(),
        },
        setNotificationEventBusMock: vi.fn<(eventBus: NotificationEventBus) => void>(),
        commandRuntimeRepairPortMock: { setProvider: vi.fn() },
        commandProjectRevisionPortMock: { setProvider: vi.fn(), setLiveMatchIgnoringSaveWrites: vi.fn() },
        externalClientManifestPortMock: { setProvider: vi.fn() },
        repairRuntimeGraphFromProjectMock: vi.fn(() => Promise.resolve()),
        sessionUndoWitnessStampPortMock: { setProvider: vi.fn() },
        stampSessionUndoWitnessMock: vi.fn(),
        composeGrandBouleMock: vi.fn(),
        // Distinguishable from the shared noop for the same reason as the
        // Toaster and MIDI-learn bindings above: the sink-wiring assertion
        // pins this exact reference, so registering some other function in
        // its place — or dropping the registration outright — fails here.
        // Returns a resolved promise so the sink wrapper pin can observe the discard: a
        // bare undefined-returning mock cannot distinguish wrapper from bare use case.
        recordNativeChainReleasesMock: vi.fn(() => Promise.resolve()),
        registerReleasedStripReportSinkMock: vi.fn<(sink: (reports: readonly unknown[]) => void) => void>(),
    };
});

vi.mock('#/infra/logger/runtimeLogger', () => ({ setRuntimeLogger: noop }));

vi.mock('#/modules/AgentAdapters/useCases', () => ({
    externalClientManifestPort: externalClientManifestPortMock,
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    getGenerationHandlers: sentinelHandlers('AiGeneration'),
    getAiMidiHandlers: sentinelHandlers('AiMidi'),
    // One stub per published descriptor: the registry refuses a map that does not cover the
    // contract, so this stands in for the real generators without pulling their graph in.
    MIDI_TRANSFORM_IMPLEMENTATIONS: Object.fromEntries(getMidiTransformNames().map((name) => [name, () => []])),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    assertCanonicalLlmActionStrategies: assertCanonicalLlmActionStrategiesMock,
    getAgentCapabilityCatalog: noop,
    getAiRuntimeProtocolContracts: noop,
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
    isRecordingMidiInputExcluded: isRecordingMidiInputExcludedMock,
    admitRecordingMidiNoteOn: noop,
    admitRecordingMidiNoteOff: noop,
    admitRecordingMidiExpression: noop,
    findOpenRecordingMidiAdmission: noop,
    findOpenRecordingMidiMemberAdmission: noop,
    getRecordingMidiAdmission: noop,
    retireRecordingMidiAdmission: noop,
    takeOwnsRecordingRoot: noop,
    recordingMidiSourceBeatAt: noop,
    getDeviceManifestProtocolContract: noop,
    setClipAudioAssetStager: noop,
    stageAudioBufferAsset: noop,
    acceptsExternalPluginAutomationParameter: noop,
    clampDeviceParameterValue: noop,
    clampExternalPluginAutomationValue: noop,
    isDeviceParameterAutomatable: noop,
    quantiseDeviceParameterValue: noop,
    getDeviceContractVersionForCommand: callbackWiring.getDeviceContractVersionForCommand,
    getDeviceTypesForCommandDeviceIds: () => ({}),
    reserveNextTrackColorForCommand: () => 'oklch(0.40 0.08 250)',
    getAllTracks: noop,
    // Reached only because the Toaster barrel is loaded for real below, which
    // pulls its preset-loading compiler into this spec's graph.
    compileLoadPresetActions: noop,
    applyDevicePatchState: () => false,
    captureDevicePatchCommitValidation: () => null,
    changesTrackOutsideDevicePlan: () => false,
    getPlannedDevicePatchState: () => null,
    getAutomationParameterRange: getAutomationParameterRangeMock,
    getPluginById: callbackWiring.getPluginById,
    persistDevicePatch: noop,
    cleanupUnusedFreezeFiles: callbackWiring.cleanupUnusedFreezeFiles,
    setTrackGain: setTrackGainMock,
    setTrackPan: setTrackPanMock,
    setDeviceParameter: noop,
    getArrangementHandlers: sentinelHandlers('Arrangement'),
    initStalenessDetection: noop,
    initTimelineViewReconciliation: initTimelineViewReconciliationMock,
    setArrangementEventBus: setArrangementEventBusMock,
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
    buildLevainZoneTables: buildLevainZoneTablesMock,
    updateDeviceParam: noop,
    holdWebFallbackDeviceParam: noop,
    // Same reason as `compileLoadPresetActions` above: the real Toaster barrel
    // brings its subscriber and note-release paths into this spec's graph.
    getToasterDeviceControls: noop,
    ensureTrackStrip: noop,
    getTrackStrip: noop,
    writeNativeBuiltinParameters: noop,
    updateDevicePatch: noop,
    getAudioContext: callbackWiring.getAudioContext,
    getCompensationDelay: noop,
    getFinalFeatureHandlers: sentinelHandlers('FinalFeature'),
    configureAudioDeviceRuntimeSink: configureAudioDeviceRuntimeSinkMock,
    configureOfflineDeviceParameterLaw: noop,
    configureOfflineMidiEventProjection: configureOfflineMidiProjectionMock,
    configureOfflinePpqEndpointProjection: configureOfflinePpqProjectionMock,
    configureOfflineYeastMidiProcessing: noop,
    stopAllScheduled: noop,
    compileAudioGraphTopology: noop,
    configureRuntimeGraphProjectRevisionValidator: configureRuntimeGraphProjectRevisionValidatorMock,
    configureRuntimeGraphTopologyValidator: configureRuntimeGraphTopologyValidatorMock,
    initEngineDeviceCollaborators: initEngineDeviceCollaboratorsMock,
    recordNativeChainReleases: recordNativeChainReleasesMock,
    isTunerTelemetryNativelyOwned: isTunerTelemetryNativelyOwnedMock,
    startMainThreadLongTaskObservation: noop,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: () => false },
}));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    stageAudioBufferAsset: vi.fn(),

    getAudioRenderingHandlers: sentinelHandlers('AudioRendering'),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationHandlers: sentinelHandlers('Automation'),
    getAutomationValueAtBeat: () => null,
    // This fixture has no lanes, so its captured evaluator has no values to read.
    createOfflineAutomationEvaluator: vi.fn(() => () => null),
    prepareAutomationTimeOperation: prepareAutomationTimeOperationMock,
    prepareAutomationTimeStateRestore: prepareAutomationTimeStateRestoreMock,
    isValidAutomationTimeStateRestorePlan: isValidAutomationTimeStateRestorePlanMock,
    recordAutomationValue: noop,
    setAutomationRecordingDependencies: noop,
    setAutomationParameterRangeResolver: setAutomationParameterRangeResolverMock,
    setModulationDependencies: callbackWiring.setModulationDependencies,
}));

vi.mock('#/modules/Bacteria/stores', () => ({ updateBacteriaMeters: callbackWiring.updateBacteriaMeters }));

vi.mock('#/modules/BrowserAi/useCases', () => ({
    initBrowserAi: initBrowserAiMock,
    initRaveModels: initRaveModelsMock,
    getRaveHandlers: sentinelHandlers('Rave'),
}));

vi.mock('#/modules/Collaboration/useCases', () => ({
    activateProjectOriginalMedia: noop,
    canExecuteCommandBatch: canExecuteCommandBatchMock,
    canMutateBranchMetadata: () => true,
    configureCollaborationAssetOwner: configureCollaborationAssetOwnerMock,
    captureProjectOriginalMedia: noop,
    configureDurableAssetCommitProof: configureDurableAssetCommitProofMock,
    getCollaborationHandlers: sentinelHandlers('Collaboration'),
    getAssetTransfer: getAssetTransferMock,
    leaveSession: noop,
    restoreProjectOriginalMedia: noop,
}));

vi.mock('#/modules/Command/useCases', () => ({
    getCommandProtocolContracts: noop,
    commandBatchPreflightPort: { setProvider: noop },
    commandBatchPreviewPort: { setProvider: noop, setRecoveryProvider: noop },
    configureCommandBatchIdempotency: configureCommandBatchIdempotencyMock,
    commandProjectDivergencePort: { setProvider: noop },
    createUserAppActionRefusalEpisodes: () => ({ execute: noop, end: noop, endAll: noop }),
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
        setSubscription: briefAdmissionWiring.setSubscription,
    },
    setActionHistoryMetadataPort: noop,
    commandProjectRevisionPort: commandProjectRevisionPortMock,
    commandDeviceVersionsPort: {
        setDeviceTypeResolver: noop,
        setResolver: callbackWiring.setCommandDeviceVersionsResolver,
    },
    commandTrackDefaultsPort: { setTrackColorProvider: noop },
    commandRuntimeRepairPort: commandRuntimeRepairPortMock,
    setCommandEventBus: noop,
    syncActionReplayMetadata: syncActionReplayMetadataMock,
    resetActionReplayAuthority: resetActionReplayAuthorityMock,
    captureCommandTargetFingerprints: noop,
    stampSessionUndoWitness: stampSessionUndoWitnessMock,
}));

vi.mock('#/modules/ControlRoom/useCases', () => ({
    getControlRoomHandlers: sentinelHandlers('ControlRoom'),
}));

vi.mock('#/modules/CvGate/useCases', () => ({
    getCvGateHandlers: sentinelHandlers('CvGate'),
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
    captureProjectRootIdentity: captureProjectRootIdentityMock,
    captureProjectRevision: captureProjectRevisionMock,
    settledProjectRevisionMatchesLiveIgnoringSaveWrites: settledProjectRevisionMatchesLiveIgnoringSaveWritesMock,
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
    subscribeToPublishedActionHistory: subscribeToPublishedActionHistoryMock,
    sessionUndoWitnessStampPort: sessionUndoWitnessStampPortMock,
    // The Crumbs device-state reconciliation is pinned by reference in its own
    // mock below, so this stands in for the document-change listeners the
    // collaboration bridge registers at session start. A noop unsubscribe is
    // all any of them need here: no document change fires under this fixture.
    subscribeToCrdtChanges: () => noop,
}));

vi.mock('#/modules/ElasticAudio/useCases', () => ({
    setElasticRootIdentityProvider: elasticRootMocks.install,
    setElasticSensitivityRootIdentityCapture: setElasticSensitivityRootIdentityCaptureMock,
}));

vi.mock('#/modules/Crumbs/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Crumbs/stores')>()),
    setCrumbsEventBus: setCrumbsEventBusMock,
}));

vi.mock('#/modules/Crumbs/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Crumbs/useCases')>()),
    prepareCrumbsEngine: callbackWiring.prepareCrumbsEngine,
}));

vi.mock('#/modules/Crust/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Crust/stores')>()),
    updateCrustMeters: callbackWiring.updateCrustMeters,
    deleteCrustMeters: callbackWiring.deleteCrustMeters,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    setGestureClockSource: callbackWiring.setGestureClockSource,
}));

vi.mock('#/modules/DawInterchange/useCases', () => ({
    getDawProjectHandlers: sentinelHandlers('DawProject'),
}));

vi.mock('#/modules/Bacteria/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Bacteria/useCases')>()),
    getBacteriaHandlers: sentinelHandlers('Bacteria'),
}));

vi.mock('#/modules/Fermenter/stores', () => ({ setFermenterTelemetry: callbackWiring.setFermenterTelemetry }));

vi.mock('#/modules/Fermenter/useCases', () => ({
    getFermenterHandlers: sentinelHandlers('Fermenter'),
    setFermenterMappedParam: noop,
    setFermenterDependencies: noop,
}));

vi.mock('#/modules/Gluten/useCases', () => ({
    getGlutenHandlers: sentinelHandlers('Gluten'),
}));

vi.mock('#/modules/Gluten/stores', () => ({
    updateGlutenMeters: noop,
    deleteGlutenMeters: noop,
}));

vi.mock('#/modules/GrandBoule/useCases', () => ({
    getGrandBouleHandlers: sentinelHandlers('GrandBoule'),
    initGrandBouleDocumentReconciliation: initGrandBouleDocumentReconciliationMock,
    prepareOfflineGrandBoule: noop,
    captureOfflineGrandBoule: vi.fn(() => {
        throw new Error('bootstrap wiring fixture does not capture Grand Boule state');
    }),
    projectGrandBouleCalibrationToNativePatch: () => null,
}));

vi.mock('#/modules/Grinder/stores', () => ({ updateGrinderTelemetry: noop }));

vi.mock('#/modules/Knead/useCases', () => ({
    getPitchHandlers: sentinelHandlers('Pitch'),
}));

vi.mock('#/modules/Levain/stores', () => ({ setEngineReady: callbackWiring.setEngineReady }));

vi.mock('#/modules/Levain/useCases', () => ({
    configureLevainZoneTableBuilder: configureLevainZoneTableBuilderMock,
    getLevainHandlers: sentinelHandlers('Levain'),
    reconcileLevainDeviceStatesFromProject: noop,
    registerLevainDevice: callbackWiring.registerLevainDevice,
    unregisterLevainDevice: noop,
    prepareOfflineLevain: prepareOfflineLevainMock,
    captureOfflineLevain: callbackWiring.captureOfflineLevain.mockImplementation(() => {
        throw new Error('bootstrap wiring fixture does not capture Levain state');
    }),
    projectLevainDeviceStateToNativePatch: projectLevainDeviceStateToNativePatchMock,
    nativeBankKeyForLevainDeviceState: nativeBankKeyForLevainDeviceStateMock,
    acquireLevainNativeBank: acquireLevainNativeBankMock,
    getLevainEngineParameterName: getLevainEngineParameterNameMock,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiTransformProtocolContract: noop,
    getMidiGrooveHandlers: sentinelHandlers('MidiGroove'),
    getMidiNoteTransformHandlers: sentinelHandlers('MidiNoteTransform'),
    prepareMidiGlobalTimeTransaction: prepareMidiGlobalTimeTransactionMock,
    prepareMidiTimeStateRestore: prepareMidiTimeStateRestoreMock,
    isValidMidiTimeStateRestorePlan: isValidMidiTimeStateRestorePlanMock,
    createChordPitchProjector: noop,
    createGrooveMidiEventProjector: noop,
    projectClipControllerEvents: noop,
    projectChannelBend: noop,
    resolveMidiNoteArticulationId: () => null,
    shouldPlayMidiEvent: () => true,
    setWebMidiRealtimeProcessor: callbackWiring.setWebMidiRealtimeProcessor,
    setWebMidiRuntimeEventBus: noop,
    setRecordingMidiAdmissionPort: setRecordingMidiAdmissionPortMock,
    getWebMidiInputHandlers: sentinelHandlers('WebMidiInput'),
    destroyWebMidi: callbackWiring.destroyWebMidi,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    getExternalPluginContractVersionForCommand: callbackWiring.getExternalPluginContractVersionForCommand,
    getPluginHostHandlers: sentinelHandlers('PluginHost'),
    registerReleasedStripReportSink: registerReleasedStripReportSinkMock,
}));

vi.mock('#/modules/Project/useCases', () => ({
    agentCapabilityDiscoveryPort: { setProvider: noop },
    getProjectProtocolContracts: noop,
    productionBriefActionBatchAdmission: { capture: () => ({ allowsCurrent: () => true }) },
    subscribeToProductionBriefChanges: briefAdmissionWiring.subscribeToProductionBriefChanges,
    getProjectHandlers: sentinelHandlers('Project'),
    initGrooveTemplateDirtyTracking: noop,
    projectOriginalMediaPort: { configure: noop },
    initPluginStateDirtyTracking: noop,
    initProjectDirtyTracking: noop,
    getDurableProjectOwnerId: getDurableProjectOwnerIdMock,
    setProjectIdentityTransitionDependencies: setProjectIdentityTransitionDependenciesMock,
}));

vi.mock('#/modules/Project/stores', () => ({
    getSettledProjectId: getDurableProjectOwnerIdMock,
    projectTransitionEpoch: { captureEditAuthority: () => ({ isCurrent: () => false }) },
}));

vi.mock('#/modules/ProjectVersioning/useCases', () => ({
    getVersionControlHandlers: sentinelHandlers('VersionControl'),
}));

vi.mock('#/modules/Proof/stores', () => ({ updateProofMeters: noop, clearProofMeters: noop }));

vi.mock('#/modules/Proof/useCases', () => ({
    getProofHandlers: sentinelHandlers('Proof'),
    registerProofDevice: noop,
    unregisterProofDevice: noop,
    syncFullPatch: noop,
    prepareOfflineProof: noop,
    captureOfflineProof: vi.fn(() => {
        throw new Error('bootstrap wiring fixture does not capture Proof state');
    }),
}));

vi.mock('#/modules/PunchRecording/useCases', () => ({
    getPunchRecordingHandlers: sentinelHandlers('PunchRecording'),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    getNodeViewHandlers: sentinelHandlers('NodeView'),
}));

vi.mock('#/modules/SampleLibrary/useCases', () => ({
    getSampleLibraryHandlers: sentinelHandlers('SampleLibrary'),
}));

vi.mock('#/modules/SessionLauncher/useCases', () => ({
    getSessionLauncherHandlers: sentinelHandlers('SessionLauncher'),
}));

vi.mock('#/modules/Setlist/useCases', () => ({
    getSetlistHandlers: sentinelHandlers('Setlist'),
    setSetlistEventBus: noop,
}));

vi.mock('#/modules/Toaster/useCases', async (importOriginal) => {
    // The projection and the preset serializer are taken from the real barrel:
    // the registration assertion below reads a real engine name out of a real
    // kit chunk, which a stub could not produce. Both are pure — kit models and
    // the engine-message projection, no store or runtime.
    const real = await importOriginal<typeof import('#/modules/Toaster/useCases')>();

    return {
        getToasterHandlers: sentinelHandlers('Toaster'),
        initToasterSubscribers: noop,
        initToasterKitPersistence: noop,
        reconcileToasterKitsFromProject: noop,
        setToasterGrooveAssignmentExecutor: toasterGrooveExecutorMock,
        prepareOfflineToaster: noop,
        captureOfflineToaster: vi.fn(() => {
            throw new Error('bootstrap wiring fixture does not capture Toaster state');
        }),
        projectToasterKitToNativePatch: real.projectToasterKitToNativePatch,
        getToasterPresetDeviceState: real.getToasterPresetDeviceState,
    };
});

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportHandlers: sentinelHandlers('Transport'),
    getTransportState: callbackWiring.getTransportState,
    createMusicalPositionProjector: noop,
    createSamplePositionProjector: noop,
    projectPpqEndpoints: noop,
    beatAtSecondsFromAnchor: beatAtSecondsFromAnchorMock,
    resolveTempoAtBeat: noop,
    prepareTimelineMapTimeOperation: prepareTimelineMapTimeOperationMock,
    prepareTimelineMapStateRestore: prepareTimelineMapStateRestoreMock,
    isValidTimelineMapStateRestorePlan: isValidTimelineMapStateRestorePlanMock,
    setStopPlaybackCallback: callbackWiring.setStopPlaybackCallback,
    reconcileVcaRuntimeGain: reconcileVcaRuntimeGainMock,
    stopPlayback: callbackWiring.stopPlayback,
    repairRuntimeGraphFromProject: repairRuntimeGraphFromProjectMock,
    readNativeEngineCursorBeats: callbackWiring.readNativeEngineCursorBeats,
}));

vi.mock('#/modules/Tuner/stores', () => ({ updateTunerTelemetry: updateTunerTelemetryMock }));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    getWorkspaceHandlers: sentinelHandlers('Workspace'),
    getScratchPadHandlers: sentinelHandlers('ScratchPad'),
    setWorkspaceEventBus: noop,
}));

vi.mock('#/modules/Yeast/stores', () => ({
    holdsKeyedYeastRack: noop,
    holdsLegacyYeastRack: noop,
    readStoredYeastRack: noop,
    readYeastRack: noop,
    setYeastEventBus: noop,
    yeastDeviceIdsInProjectOrder: noop,
}));

vi.mock('#/modules/Yeast/useCases', () => ({
    configureYeastRuntime: noop,
    createOfflineYeastMidiProcessor: noop,
    getYeastHandlers: sentinelHandlers('Yeast'),
    processRealtimeMidiInput: noop,
    teardownYeastRuntime: callbackWiring.teardownYeastRuntime,
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

vi.mock('../registerProjectSlotProjections', () => ({
    registerProjectSlotProjections: registerProjectSlotProjectionsMock,
}));

vi.mock('../registerProjectLifecycle', () => ({
    registerProjectLifecycle: registerProjectLifecycleMock,
}));

vi.mock('../registerDeviceEnginePorts', () => ({
    registerDeviceEnginePorts: registerDeviceEnginePortsMock,
}));

vi.mock('../registerSupportingServicePorts', () => ({
    registerSupportingServicePorts: registerSupportingServicePortsMock,
}));

vi.mock('../registerKernelPorts', () => ({
    registerKernelPorts: registerKernelPortsMock,
}));

vi.mock('../composeGrandBoule', () => ({
    composeGrandBoule: composeGrandBouleMock,
}));

vi.mock('../initCrumbsModePush', () => ({
    initCrumbsModePush: initCrumbsModePushMock,
}));

vi.mock('../initDeviceStateReconciliation', () => ({
    initDeviceStateReconciliation: initDeviceStateReconciliationMock,
}));
vi.mock('../initAudioBufferCacheAccess', () => ({
    initAudioBufferCacheAccess: initAudioBufferCacheAccessMock,
}));
vi.mock('../initInputMonitoringProjectAccess', () => ({
    initInputMonitoringProjectAccess: initInputMonitoringProjectAccessMock,
}));
vi.mock('../initLevainDeviceStateProjectAccess', () => ({
    initLevainDeviceStateProjectAccess: initLevainDeviceStateProjectAccessMock,
}));

const fillCallsBeforeEntry = {
    initBranchState: initBranchStateMock.mock.calls.length,
    registerDeviceEnginePorts: registerDeviceEnginePortsMock.mock.calls.length,
    registerProductionCommandHandlers: registerProductionCommandHandlersMock.mock.calls.length,
    setProjectIdentityTransitionDependencies: setProjectIdentityTransitionDependenciesMock.mock.calls.length,
};

bootstrapApplication();

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
    it('fills nothing when the module is imported, only when its entry runs', () => {
        expect(fillCallsBeforeEntry).toEqual({
            initBranchState: 0,
            registerDeviceEnginePorts: 0,
            registerProductionCommandHandlers: 0,
            setProjectIdentityTransitionDependencies: 0,
        });
        expect(initBranchStateMock).toHaveBeenCalledOnce();
        expect(registerDeviceEnginePortsMock).toHaveBeenCalledOnce();
        expect(registerProductionCommandHandlersMock).toHaveBeenCalledOnce();
        expect(setProjectIdentityTransitionDependenciesMock).toHaveBeenCalledOnce();
    });

    it('delegates the live root reader installation for sensitivity and Worker lifetimes before consumers', () => {
        // The wiring itself lives in registerSupportingServicePorts; bootstrap must
        // delegate to it before any command handler can consume transient detection.
        expect(registerSupportingServicePortsMock).toHaveBeenCalledExactlyOnceWith();
        expect(elasticRootMocks.install).not.toHaveBeenCalled();
        expect(setElasticSensitivityRootIdentityCaptureMock).not.toHaveBeenCalled();
        expect(captureProjectRootIdentityMock).not.toHaveBeenCalled();
        expect(registerSupportingServicePortsMock.mock.invocationCallOrder[0]!).toBeLessThan(
            registerProductionCommandHandlersMock.mock.invocationCallOrder[0]!
        );
    });
    it('binds committed project access during bootstrap', () => {
        expect(initInputMonitoringProjectAccessMock).toHaveBeenCalledExactlyOnceWith();
    });
    it('routes published history and root replacement to the Command replay authority callbacks', () => {
        expect(subscribeToPublishedActionHistoryMock).toHaveBeenCalledOnce();
        expect(actionHistoryStoreMock.subscribe).not.toHaveBeenCalled();
        const observer = subscribeToPublishedActionHistoryMock.mock.calls[0]?.[0];
        if (!observer) {
            throw new Error('bootstrap never registered the published history observer');
        }
        const entries: Parameters<PublishedHistoryObserver['onHistory']>[0] = [
            {
                id: 'bootstrap-history-entry',
                label: 'Set snap',
                actionKind: 'setSnapValue',
                source: 'manual',
                timestamp: 1,
                reverted: false,
            },
        ];
        syncActionReplayMetadataMock.mockClear();
        resetActionReplayAuthorityMock.mockClear();

        observer.onHistory(entries);

        expect(syncActionReplayMetadataMock).toHaveBeenCalledExactlyOnceWith(entries);
        expect(resetActionReplayAuthorityMock).not.toHaveBeenCalled();

        observer.onRootReplaced();

        expect(resetActionReplayAuthorityMock).toHaveBeenCalledExactlyOnceWith();
        expect(syncActionReplayMetadataMock).toHaveBeenCalledExactlyOnceWith(entries);
    });
    it('binds committed Levain membership before document reconciliation subscribes', () => {
        expect(initLevainDeviceStateProjectAccessMock).toHaveBeenCalledExactlyOnceWith();
        expect(initLevainDeviceStateProjectAccessMock.mock.invocationCallOrder[0]).toBeLessThan(
            initDeviceStateReconciliationMock.mock.invocationCallOrder[0]!
        );
    });
    // The exact order bootstrap.ts passes module handler maps to the production assembler.
    // This list IS the assertion: every module bootstrap wires into the shared
    // handler registry must appear here
    // exactly once, in registration order — proving the wiring is both complete
    // (nothing missing) and idempotent (nothing registered twice).
    const expectedRegistrationOrder = [
        'Arrangement',
        'SampleLibrary',
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
        'MidiNoteTransform',
        'DrumPreviewBranch',
        'MidiGroove',
        'ControlSurface',
        'ScratchPad',
        'Macro',
        'UndoRedo',
        'UndoTree',
        'Pitch',
        'SongStructure',
        'Project',
        'VersionControl',
        'DawProject',
        'FinalFeature',
        'CvGate',
        'Bacteria',
        'Fermenter',
        'GrandBoule',
        'Levain',
        'Toaster',
        'Gluten',
        'Proof',
        'NodeView',
        'WebMidiInput',
        'Rave',
        'ControlRoom',
        'Yeast',
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

    it('configures both offline tempo directions through Transport', () => {
        expect(configureOfflinePpqProjectionMock).toHaveBeenCalledExactlyOnceWith({
            project: noop,
            resolveTempoAtBeat: noop,
            beatAtSecondsFromAnchor: beatAtSecondsFromAnchorMock,
        });
    });

    it('hands the offline render the MIDI module’s own stored-controller and channel-bend projections', () => {
        expect(configureOfflineMidiProjectionMock).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ projectClipControllers: noop, projectChannelBend: noop })
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

    it('hands the production brief change subscription to the admission port', () => {
        expect(briefAdmissionWiring.setSubscription).toHaveBeenCalledExactlyOnceWith(
            briefAdmissionWiring.subscribeToProductionBriefChanges
        );
    });

    it('wires project runtime validation and event buses in the composition root', () => {
        expect(registerCrdtStorageRuntimeMock).toHaveBeenCalledExactlyOnceWith();
        expect(registerProjectSlotProjectionsMock).toHaveBeenCalledExactlyOnceWith();
        expect(registerProjectSlotProjectionsMock).toHaveBeenCalledAfter(registerCrdtStorageRuntimeMock);
        // Before anything can reset or load a project: until it runs, a
        // project switch would throw instead of resetting the modules.
        expect(registerProjectLifecycleMock).toHaveBeenCalledExactlyOnceWith();
        expect(registerProjectLifecycleMock).toHaveBeenCalledAfter(registerProjectSlotProjectionsMock);
        // Before a project can load and play: until it runs, a native body,
        // an automation write or the preset library would throw instead of
        // reaching the device module that owns its answer.
        expect(registerDeviceEnginePortsMock).toHaveBeenCalledExactlyOnceWith();
        expect(registerDeviceEnginePortsMock).toHaveBeenCalledAfter(registerProjectLifecycleMock);
        expect(registerDeviceEnginePortsMock).toHaveBeenCalledBefore(setProjectIdentityTransitionDependenciesMock);
        // Beside the device ports, before an import, a save or playback can
        // reach a supporting module through a port.
        expect(registerSupportingServicePortsMock).toHaveBeenCalledExactlyOnceWith();
        expect(registerSupportingServicePortsMock).toHaveBeenCalledAfter(registerDeviceEnginePortsMock);
        expect(registerSupportingServicePortsMock).toHaveBeenCalledBefore(setProjectIdentityTransitionDependenciesMock);
        // Beside the supporting ports, before an undo, a macro replay or a
        // branch switch can reach a core domain through a kernel port.
        expect(registerKernelPortsMock).toHaveBeenCalledExactlyOnceWith();
        expect(registerKernelPortsMock).toHaveBeenCalledAfter(registerSupportingServicePortsMock);
        expect(registerKernelPortsMock).toHaveBeenCalledBefore(setProjectIdentityTransitionDependenciesMock);
        expect(agentProjectInspectionSetProviderMock).toHaveBeenCalledExactlyOnceWith(
            captureAgentProjectInspectionState
        );
        expect(setArrangementEventBusMock).toHaveBeenCalledExactlyOnceWith(eventBusMock);
        expect(setRecordingMidiAdmissionPortMock).toHaveBeenCalledExactlyOnceWith({
            isRecordingMidiInputExcluded: isRecordingMidiInputExcludedMock,
            admitRecordingMidiNoteOn: noop,
            admitRecordingMidiNoteOff: noop,
            admitRecordingMidiExpression: noop,
            findOpenRecordingMidiAdmission: noop,
            findOpenRecordingMidiMemberAdmission: noop,
            getRecordingMidiAdmission: noop,
            retireRecordingMidiAdmission: noop,
            takeOwnsRecordingRoot: noop,
            recordingMidiSourceBeatAt: noop,
        });

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
        expect(initEngineDeviceCollaboratorsMock).toHaveBeenCalledExactlyOnceWith();
        expect(setNotificationEventBusMock).toHaveBeenCalledExactlyOnceWith(eventBusMock);
    });

    it('registers the exact forward and restore global-time owner preparations', () => {
        expect(setTimeOperationDependenciesMock).toHaveBeenCalledExactlyOnceWith({
            savedRestorePlanValidators: {
                automation: isValidAutomationTimeStateRestorePlanMock,
                midi: isValidMidiTimeStateRestorePlanMock,
                timelineMap: isValidTimelineMapStateRestorePlanMock,
            },
            prepareAutomationTimeOperation: prepareAutomationTimeOperationMock,
            prepareAutomationTimeStateRestore: prepareAutomationTimeStateRestoreMock,
            prepareMidiGlobalTimeTransaction: prepareMidiGlobalTimeTransactionMock,
            prepareMidiTimeStateRestore: prepareMidiTimeStateRestoreMock,
            prepareTimelineMapTimeOperation: prepareTimelineMapTimeOperationMock,
            prepareTimelineMapStateRestore: prepareTimelineMapStateRestoreMock,
        });
        expect(setTimeOperationDependenciesMock.mock.invocationCallOrder[0]).toBeLessThan(
            registerProductionCommandHandlersMock.mock.invocationCallOrder[0]!
        );
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

    it('lets command finalization tolerate a save, but not an unflushed edit, by registering the settling save-insensitive revision matcher', () => {
        expect(commandProjectRevisionPortMock.setLiveMatchIgnoringSaveWrites).toHaveBeenCalledExactlyOnceWith(
            settledProjectRevisionMatchesLiveIgnoringSaveWritesMock
        );
    });

    it('offers external clients the published protocol manifest, not a second list', () => {
        expect(externalClientManifestPortMock.setProvider).toHaveBeenCalledExactlyOnceWith(getAgentProtocolManifest);
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
    /**
     * The sink's slot returns void while the queued write returns a promise, so
     * bootstrap registers a discarding wrapper rather than the use case itself
     * (#3888). Identity pinning would miss the wrapper, so pin the contract: the
     * registered function forwards the reports to the use case and returns void.
     */
    it('wires an unload plugin release report to narrow the native chain session AudioEngine holds', () => {
        expect(registerReleasedStripReportSinkMock).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
        const [registered] = registerReleasedStripReportSinkMock.mock.calls[0] ?? [];
        if (registered === undefined) {
            throw new Error('expected the sink registration to carry a function');
        }
        const reports = [{ id: 'audio-1', deviceIds: ['comp'] }];
        const returned = registered(reports);
        expect(recordNativeChainReleasesMock).toHaveBeenCalledExactlyOnceWith(reports);
        expect(returned).toBeUndefined();
    });

    /**
     * The audio cache's durable-ownership and live-reference reads can only be
     * bound by the composition root; `initAudioBufferCacheAccess.spec.ts` pins
     * what each binding reads.
     */
    it('binds the audio cache ownership and residency reads during bootstrap', () => {
        expect(initAudioBufferCacheAccessMock).toHaveBeenCalledExactlyOnceWith();
        expect(initAudioBufferCacheAccessMock.mock.invocationCallOrder[0]).toBeLessThan(
            initInputMonitoringProjectAccessMock.mock.invocationCallOrder[0] ?? 0
        );
    });

    /**
     * Levain loads every bank's zone tables through a builder it is handed, not
     * one it imports, and the composition root is the only place that can hand
     * it AudioEngine's Worker-backed `buildLevainZoneTables`. Pinned by
     * reference: dropping the registration leaves every bank load rejecting
     * with "builder is not configured".
     */
    it("wires the Levain zone table builder to AudioEngine's off-render-thread build", () => {
        expect(configureLevainZoneTableBuilderMock).toHaveBeenCalledExactlyOnceWith(buildLevainZoneTablesMock);
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

        /**
         * The native mirror of the rows above, and the only place that knows a
         * Toaster's kit is not a `parameterValues` table: the mapper may not
         * import a device module's use cases, so an unwired `toaster` row
         * leaves a natively carried Toaster playing the engine's built-in kit
         * instead of the project's, with nothing reporting it.
         *
         * The chunk comes from the Toaster model's own serializer, so the row
         * is read through the shape the document actually stores. Gluten is the
         * counterpart: a body whose whole surface already arrives as
         * `parameterValues` answers `null` rather than an empty record.
         */
        it('projects a toaster’s stored kit into the engine’s own names, and nothing for a body with no kit', () => {
            const stored = getToasterPresetDeviceState('init');
            if (!stored || typeof stored.data.kit !== 'object' || stored.data.kit === null) {
                throw new Error('the factory kit chunk is missing its kit payload');
            }
            if (Array.isArray(stored.data.kit)) {
                throw new TypeError('the factory kit chunk holds an array where the kit belongs');
            }
            const chunk = { ...stored, data: { kit: { ...stored.data.kit, masterGain: 0.4 } } };

            expect(
                getSink().projectNativeDeviceState({ deviceId: 'device-a', deviceType: 'toaster', deviceState: chunk })
            ).toEqual(expect.objectContaining({ master_gain: 0.4 }));
            expect(
                getSink().projectNativeDeviceState({ deviceId: 'device-a', deviceType: 'gluten', deviceState: chunk })
            ).toBeNull();
        });

        /**
         * The sampler's articulation rides `deviceState` as a string, so an
         * unwired `levain` row leaves a natively carried strip sounding the
         * engine's default articulation whatever the project saved.
         */
        it('projects a levain device’s articulation through the Levain module', () => {
            const chunk = { version: 1, data: { instrumentId: 'violin-1', currentArticulation: 'staccato' } };

            expect(
                getSink().projectNativeDeviceState({ deviceId: 'device-a', deviceType: 'levain', deviceState: chunk })
            ).toEqual({
                current_articulation: 4,
            });
            expect(projectLevainDeviceStateToNativePatchMock).toHaveBeenCalledWith({ deviceState: chunk });
        });

        /**
         * The bank door beside the row above. `map_device` refuses a Levain
         * device whose key holds no committed bank, so an unwired row is a
         * strip the engine will not build at all — and a row wired for a body
         * built from its own record would stage material nothing reads.
         */
        it('names the bank a levain device sounds, and nothing for a body built from its record', () => {
            const chunk = { version: 1, data: { instrumentId: 'violin-1', currentArticulation: 'sustain' } };

            expect(getSink().nativeSampleBankKey({ deviceType: 'levain', deviceState: chunk })).toBe('levain:violin-1');
            expect(nativeBankKeyForLevainDeviceStateMock).toHaveBeenCalledWith({ deviceState: chunk });
            expect(getSink().nativeSampleBankKey({ deviceType: 'toaster', deviceState: chunk })).toBeNull();
            expect(getSink().nativeSampleBankKey({ deviceType: 'builtin-eq', deviceState: chunk })).toBeNull();
        });

        /**
         * The modulation-routing mirror of the bank door above: Bacteria is
         * the one native body whose `deviceState` carries a variable-length
         * table rather than a fixed `parameterValues` vocabulary, so an
         * unwired row leaves a natively carried Bacteria instance playing with
         * no routing at all while the Web Audio twin still hears the project's
         * table.
         */
        it('maps a bacteria device’s routing table onto the engine’s own grammar, and nothing for a body with no such door', () => {
            const chunk = {
                version: 1,
                data: {
                    modAssignments: [{ sourceId: 'lfo1', targetParam: 'mix', amount: 0.5, bipolar: false }],
                },
            };

            expect(getSink().nativeModAssignments({ deviceType: 'bacteria', deviceState: chunk })).toEqual([
                { sourceId: 0, targetParam: 0, amount: 0.5 },
            ]);
            expect(getSink().nativeModAssignments({ deviceType: 'toaster', deviceState: chunk })).toBeNull();
        });

        /**
         * The vocabulary beside those two rows. Levain delivers its panel's
         * live writes into AudioEngine, so AudioEngine asks here for the
         * sampler's engine names rather than importing the module back. An
         * unwired row leaves every natively carried Levain write addressed by a
         * panel id the engine cannot resolve — and one unresolvable name
         * refuses the whole batch, not just its own write.
         */
        it('spells a levain parameter through the Levain module, and nothing for a body that spells its own', () => {
            expect(getSink().nativeBuiltinParameterName({ deviceType: 'levain', paramId: 'masterGain' })).toBe(
                'master_gain'
            );
            expect(getLevainEngineParameterNameMock).toHaveBeenCalledWith({ paramId: 'masterGain' });
            expect(getSink().nativeBuiltinParameterName({ deviceType: 'fermenter', paramId: 'oscEngine' })).toBeNull();
        });

        it('routes a bank acquisition to the module that minted the key', async () => {
            await getSink().acquireNativeSampleBank('levain:violin-1');

            expect(acquireLevainNativeBankMock).toHaveBeenCalledWith('levain:violin-1');
        });
    });

    /**
     * The Tuner is the one device two analysers can report for at once: the
     * native body publishes on the transport poll, and the Web Audio twin's
     * worklet keeps posting from a graph that goes on rendering behind a
     * shadowed carrier. Both publishes land in one store, so the root is where
     * one of them has to be dropped — and it is the only place that can, since
     * neither producer can see the other.
     */
    describe('tuner telemetry arbitration', () => {
        function getSink(): RuntimeSinkUnderTest {
            const call = configureAudioDeviceRuntimeSinkMock.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never configured the audio device runtime sink');
            }
            return call[0];
        }

        const reading: TunerReadingUnderTest = {
            active: true,
            frequency: 439.5,
            cents: -2,
            confidence: 0.9,
            noteIndex: 9,
            octave: 4,
            midiNote: 69,
            noteName: 'A',
        };

        beforeEach(() => {
            updateTunerTelemetryMock.mockClear();
            isTunerTelemetryNativelyOwnedMock.mockReset();
            isTunerTelemetryNativelyOwnedMock.mockReturnValue(false);
        });

        it('drops the web publish for a device the native session owns', () => {
            isTunerTelemetryNativelyOwnedMock.mockReturnValue(true);

            getSink().updateTunerTelemetry('d-tuner', reading);

            expect(isTunerTelemetryNativelyOwnedMock).toHaveBeenCalledWith('d-tuner');
            expect(updateTunerTelemetryMock).not.toHaveBeenCalled();
        });

        it('lets the web publish reach the store for a device the native session does not own', () => {
            getSink().updateTunerTelemetry('d-tuner', reading);

            expect(updateTunerTelemetryMock).toHaveBeenCalledExactlyOnceWith('d-tuner', reading);
        });

        // No predicate on this side: `publishNativeTunerTelemetry` already
        // filtered the poll's map by the same answer, so a reading arriving
        // here is one this session owns.
        it('lets the native publish reach the store unconditionally', () => {
            isTunerTelemetryNativelyOwnedMock.mockReturnValue(true);

            getSink().updateNativeTunerTelemetry('d-tuner', reading);

            expect(updateTunerTelemetryMock).toHaveBeenCalledExactlyOnceWith('d-tuner', reading);
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

    it('registers Grand Boule document reconciliation as an explicit boot step', () => {
        // A peer's device-state commit, an undo, or a bulk load rewrites the
        // document without re-running any app action; without this registration
        // the per-device store sits in the stale-mirror window #4894 describes.
        expect(initGrandBouleDocumentReconciliationMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('registers Crumbs device-state reconciliation as an explicit boot step', () => {
        // The same document-origin trigger, one module over: a peer's Crumbs
        // sample/mode commit, an undo, or a bulk load rewrites the document
        // without re-running any app action. Without this registration a loaded
        // Crumbs keeps its stale deviceState until reload, and its next local
        // edit commits that stale store over the peer's change (#4764). Pinned
        // by reference like the Grand Boule registration above.
        expect(initDeviceStateReconciliationMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('registers the timeline view reconciliation as an explicit boot step', () => {
        // Deleting a track or collapsing a folder shrinks the timeline's
        // content, and a clip can leave the project by undo, a collaborator's
        // delete or a project load; without this registration the scroll offset
        // stays past the last row and the selection keeps ids of missing clips.
        expect(initTimelineViewReconciliationMock).toHaveBeenCalledExactlyOnceWith();
    });

    it('wires the Crumbs mode push to the shared event bus', () => {
        // The strip half of every Crumbs mode change rides the
        // `crumbs.modeChanged` signal (#4764): without this registration a
        // mid-session mode change moves the panel and the persisted document
        // and leaves the audio alone. Pinned by reference so dropping the
        // registration fails here instead of at the first silent mode change.
        expect(initCrumbsModePushMock).toHaveBeenCalledExactlyOnceWith(eventBusMock);
    });

    it('wires the Crumbs module event bus in the composition root', () => {
        // The mode signal's emitter is injected, not imported: the Crumbs
        // module cannot reach the app's event bus itself. Dropping the
        // registration leaves every `crumbs.modeChanged` emit silent — the
        // mode push above included. Pinned by reference.
        expect(setCrumbsEventBusMock).toHaveBeenCalledExactlyOnceWith(eventBusMock);
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
        (await import('../bootstrap')).bootstrapApplication();

        expect(recoverInterruptedAgentRunsMock).toHaveBeenCalledExactlyOnceWith();
        expect(recoverRetainedSectionRenderEffectsMock).not.toHaveBeenCalled();

        resolveInterruptedRecovery({ recoveredRunIds: [] });

        await vi.waitFor(() => expect(recoverRetainedSectionRenderEffectsMock).toHaveBeenCalledExactlyOnceWith());

        recoverInterruptedAgentRunsMock.mockClear();
        recoverRetainedSectionRenderEffectsMock.mockClear();
        loggerMock.error.mockClear();
        recoverInterruptedAgentRunsMock.mockImplementationOnce(() => Promise.reject(new Error('hydration failed')));

        vi.resetModules();
        (await import('../bootstrap')).bootstrapApplication();

        await vi.waitFor(() =>
            expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ message: 'Interrupted AI runs could not be recovered during startup' })
            )
        );
        expect(recoverInterruptedAgentRunsMock).toHaveBeenCalledExactlyOnceWith();
        expect(recoverRetainedSectionRenderEffectsMock).not.toHaveBeenCalled();
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

    describe('command device version resolution', () => {
        function getResolver(): (deviceType: string) => string | undefined {
            const call = callbackWiring.setCommandDeviceVersionsResolver.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never registered the command device version resolver');
            }
            return call[0];
        }

        beforeEach(() => {
            callbackWiring.getDeviceContractVersionForCommand.mockReset();
            callbackWiring.getExternalPluginContractVersionForCommand.mockReset();
        });

        it('answers a built-in device type from the Arrangement descriptor without asking PluginHost', () => {
            callbackWiring.getDeviceContractVersionForCommand.mockReturnValue('descriptor-v1:toaster');

            expect(getResolver()('toaster')).toBe('descriptor-v1:toaster');
            expect(callbackWiring.getDeviceContractVersionForCommand).toHaveBeenCalledExactlyOnceWith('toaster');
            expect(callbackWiring.getExternalPluginContractVersionForCommand).not.toHaveBeenCalled();
        });

        it('falls back to the hosted plugin contract for a type no built-in descriptor owns', () => {
            callbackWiring.getDeviceContractVersionForCommand.mockReturnValue(undefined);
            callbackWiring.getExternalPluginContractVersionForCommand.mockReturnValue('external-plugin-v1:vst3-abc');

            expect(getResolver()('external:vst3-abc')).toBe('external-plugin-v1:vst3-abc');
            expect(callbackWiring.getExternalPluginContractVersionForCommand).toHaveBeenCalledExactlyOnceWith(
                'external:vst3-abc'
            );
        });

        it('stays unresolved when neither owner knows the type', () => {
            expect(getResolver()('unknown')).toBeUndefined();
        });
    });

    it('stops resuming owner handoffs when the project-load authority turns stale after the asset transfer resolves', async () => {
        const resumeDurableOwnerRebindsAfterProjectLoad = vi.fn<DurableAssetOwnerRecoveryAfterProjectLoad>(() =>
            Promise.resolve()
        );
        const controller = new AbortController();
        getAssetTransferMock.mockImplementationOnce(() => {
            controller.abort();
            return { resumeDurableOwnerRebindsAfterProjectLoad };
        });

        await getDurableAssetOwnerRecoveryAfterProjectLoad()({
            ownerId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            isCurrent: () => true,
            signal: controller.signal,
        });

        expect(getAssetTransferMock).toHaveBeenCalled();
        expect(resumeDurableOwnerRebindsAfterProjectLoad).not.toHaveBeenCalled();
    });

    describe('page lifecycle teardown', () => {
        function getBeforeUnloadHandler(): () => void {
            const registrations: readonly (readonly unknown[])[] = callbackWiring.beforeUnloadSpy.mock.calls;
            const listener = registrations.find(([type]) => type === 'beforeunload')?.[1];
            if (typeof listener !== 'function') {
                throw new TypeError('bootstrap never registered a beforeunload handler');
            }
            return () => {
                listener.call(window, new Event('beforeunload'));
            };
        }

        beforeEach(() => {
            callbackWiring.destroyWebMidi.mockClear();
            callbackWiring.disposeWebMidiRealtimeProcessor.mockClear();
            callbackWiring.teardownYeastRuntime.mockClear();
            callbackWiring.cleanupUnusedFreezeFiles.mockClear();
        });

        it('releases WebMIDI before the Yeast bridge it routes through is retired', () => {
            getBeforeUnloadHandler()();

            expect(callbackWiring.destroyWebMidi).toHaveBeenCalledOnce();
            expect(callbackWiring.disposeWebMidiRealtimeProcessor).toHaveBeenCalledOnce();
            expect(callbackWiring.teardownYeastRuntime).toHaveBeenCalledOnce();
            const [destroyOrder] = callbackWiring.destroyWebMidi.mock.invocationCallOrder;
            const [disposeOrder] = callbackWiring.disposeWebMidiRealtimeProcessor.mock.invocationCallOrder;
            const [teardownOrder] = callbackWiring.teardownYeastRuntime.mock.invocationCallOrder;
            expect(destroyOrder).toBeLessThan(disposeOrder ?? Number.NEGATIVE_INFINITY);
            expect(disposeOrder).toBeLessThan(teardownOrder ?? Number.NEGATIVE_INFINITY);
        });

        it('attempts to collect unused freeze files and tolerates that attempt failing', () => {
            callbackWiring.cleanupUnusedFreezeFiles.mockReturnValueOnce(Promise.reject(new Error('disk gone')));

            expect(getBeforeUnloadHandler()).not.toThrow();
            expect(callbackWiring.cleanupUnusedFreezeFiles).toHaveBeenCalledOnce();
        });
    });

    describe('device control dependencies', () => {
        function getGestureClockSource() {
            const call = callbackWiring.setGestureClockSource.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never registered the gesture clock source');
            }
            return call[0];
        }

        function getModulationDependencies(): ModulationDependencies {
            const call = callbackWiring.setModulationDependencies.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never registered the modulation dependencies');
            }
            return call[0];
        }

        function getMidiLearnDependencies() {
            const call = setMidiLearnDependenciesMock.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never registered the MIDI learn dependencies');
            }
            return call[0] as {
                getTransportIsPlaying: () => boolean;
                getTransportPlayheadPosition: () => number;
            };
        }

        beforeEach(() => {
            loggerMock.error.mockClear();
            callbackWiring.stopPlayback.mockReset();
            callbackWiring.getPluginById.mockReset();
            callbackWiring.getTransportState.mockReset();
            callbackWiring.getAudioContext.mockReset();
            callbackWiring.readNativeEngineCursorBeats.mockReset();
        });

        it('asks the scheduler to stop when Transport requests a stop', () => {
            callbackWiring.stopPlayback.mockReturnValue(Promise.resolve());
            const requestStop = callbackWiring.setStopPlaybackCallback.mock.calls[0]?.[0];
            if (!requestStop) {
                throw new Error('bootstrap never registered the stop playback callback');
            }

            requestStop();

            expect(callbackWiring.stopPlayback).toHaveBeenCalledOnce();
            expect(loggerMock.error).not.toHaveBeenCalled();
        });

        it('logs a failed scheduler stop request with its cause instead of leaving it unhandled', async () => {
            const failure = new Error('worklet gone');
            callbackWiring.stopPlayback.mockReturnValue(Promise.reject(failure));
            const requestStop = callbackWiring.setStopPlaybackCallback.mock.calls[0]?.[0];
            if (!requestStop) {
                throw new Error('bootstrap never registered the stop playback callback');
            }

            requestStop();

            await vi.waitFor(() =>
                expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith(
                    expect.objectContaining({ message: 'Scheduler stop request failed', cause: failure })
                )
            );
        });

        it('timestamps gestures from the live audio clock', () => {
            callbackWiring.getAudioContext.mockReturnValue({ currentTime: 4.5 });

            expect(getGestureClockSource().getAudioTimeSeconds()).toBe(4.5);
        });

        it('follows the native engine cursor, or null when it is not the audible transport', () => {
            callbackWiring.readNativeEngineCursorBeats.mockReturnValueOnce(12.25).mockReturnValueOnce(null);

            expect(getGestureClockSource().readNativeCursorBeats()).toBe(12.25);
            expect(getGestureClockSource().readNativeCursorBeats()).toBeNull();
        });

        it('resolves a modulation target range from the plugin descriptor parameter with that id', () => {
            callbackWiring.getPluginById.mockReturnValue({
                parameters: [
                    { id: 'cutoff', minValue: 20, maxValue: 20_000, defaultValue: 1000, automatable: true },
                    { id: 'drive', minValue: 0, maxValue: 1, defaultValue: 0.25, automatable: false },
                ],
            });

            expect(getModulationDependencies().getPluginParamRange('filter', 'drive')).toEqual({
                min: 0,
                max: 1,
                defaultValue: 0.25,
                automatable: false,
            });
            expect(callbackWiring.getPluginById).toHaveBeenCalledExactlyOnceWith('filter');
        });

        it('has no modulation range for an unknown parameter or an unknown device type', () => {
            callbackWiring.getPluginById.mockReturnValueOnce({
                parameters: [{ id: 'cutoff', minValue: 20, maxValue: 20_000, defaultValue: 1000, automatable: true }],
            });

            expect(getModulationDependencies().getPluginParamRange('filter', 'missing')).toBeNull();
            expect(getModulationDependencies().getPluginParamRange('absent', 'cutoff')).toBeNull();
        });

        it('lets MIDI learn read the transport play state and playhead', () => {
            callbackWiring.getTransportState.mockReturnValue({ isPlaying: true, playheadPosition: 7.5 });

            expect(getMidiLearnDependencies().getTransportIsPlaying()).toBe(true);
            expect(getMidiLearnDependencies().getTransportPlayheadPosition()).toBe(7.5);
        });

        it('reports a stopped transport at the origin to MIDI learn before Transport has state', () => {
            callbackWiring.getTransportState.mockReturnValue(undefined);

            expect(getMidiLearnDependencies().getTransportIsPlaying()).toBe(false);
            expect(getMidiLearnDependencies().getTransportPlayheadPosition()).toBe(0);
        });
    });

    describe('audio device runtime sink forwarding', () => {
        function getSink(): RuntimeSinkUnderTest {
            const call = configureAudioDeviceRuntimeSinkMock.mock.calls[0];
            if (!call) {
                throw new Error('bootstrap never configured the audio device runtime sink');
            }
            return call[0];
        }

        const port = { postMessage: () => {} } as unknown as MessagePort;

        beforeEach(() => {
            eventBusMock.emit.mockClear();
        });

        it('publishes a loaded device on the event bus under its own event name', () => {
            const payload = { deviceId: 'd1', deviceType: 'levain' };

            getSink().emitDeviceLoaded(payload);

            expect(eventBusMock.emit).toHaveBeenCalledExactlyOnceWith('audioDevice.loaded', payload);
        });

        it('publishes a removed device on the event bus under its own event name', () => {
            const payload = { deviceId: 'd1', deviceType: 'levain' };

            getSink().emitDeviceRemoved(payload);

            expect(eventBusMock.emit).toHaveBeenCalledExactlyOnceWith('audioDevice.removed', payload);
        });

        it('registers a Levain device positionally and returns the sample load outcome', () => {
            const device = { id: 'levain-1' };
            const onProgress = vi.fn();
            callbackWiring.registerLevainDevice.mockReturnValueOnce('loaded');

            const outcome = getSink().registerLevainDevice({ deviceId: 'levain-1', device, port, onProgress });

            expect(outcome).toBe('loaded');
            expect(callbackWiring.registerLevainDevice).toHaveBeenCalledExactlyOnceWith(
                'levain-1',
                device,
                port,
                onProgress
            );
        });

        it('hands a Levain engine readiness change to the Levain store by device', () => {
            getSink().setLevainEngineReady({ deviceId: 'levain-1', isReady: true });

            expect(callbackWiring.setEngineReady).toHaveBeenCalledExactlyOnceWith('levain-1', true);
        });

        it('prepares a Crumbs device through the one shared Crumbs use case and returns its outcome', async () => {
            const controller = new AbortController();
            callbackWiring.prepareCrumbsEngine.mockResolvedValueOnce('ready');

            await expect(
                getSink().prepareCrumbsDevice({ deviceId: 'crumbs-1', port, signal: controller.signal })
            ).resolves.toBe('ready');

            expect(callbackWiring.prepareCrumbsEngine).toHaveBeenCalledExactlyOnceWith({
                deviceId: 'crumbs-1',
                port,
                signal: controller.signal,
            });
        });

        it('spreads a Fermenter telemetry frame into the store’s positional arguments', () => {
            const scopeBuffer = new Float32Array([0.1, -0.2]);

            getSink().setFermenterTelemetry('fermenter-1', { peakL: 0.5, peakR: 0.25, scopeBuffer });

            expect(callbackWiring.setFermenterTelemetry).toHaveBeenCalledExactlyOnceWith(
                'fermenter-1',
                0.5,
                0.25,
                scopeBuffer
            );
        });

        it('scopes a Crust meter frame to its device and forwards only the meter fields', () => {
            getSink().updateCrustMeters('crust-2', {
                grDb: -3,
                inputDb: -12,
                outputDb: -9,
                lufsIntegrated: -14,
                lufsShortTerm: -13,
                lufsMomentary: -11,
                lra: 5,
                truepeakMax: -1,
                truepeakExceeded: false,
                unrelatedField: 'dropped',
            });

            expect(callbackWiring.updateCrustMeters).toHaveBeenCalledExactlyOnceWith('crust-2', {
                grDb: -3,
                inputDb: -12,
                outputDb: -9,
                lufsIntegrated: -14,
                lufsShortTerm: -13,
                lufsMomentary: -11,
                lra: 5,
                truepeakMax: -1,
                truepeakExceeded: false,
            });
        });

        it('drops only the torn-down Crust device’s meters', () => {
            getSink().deleteCrustMeters('crust-2');

            expect(callbackWiring.deleteCrustMeters).toHaveBeenCalledExactlyOnceWith('crust-2');
        });

        it('spreads a Bacteria meter frame into the store’s positional arguments', () => {
            getSink().updateBacteriaMeters('bacteria-1', {
                inputDb: -20,
                outputDb: -18,
                bandLevels: [-30, -25, -40],
                latency: 64,
            });

            expect(callbackWiring.updateBacteriaMeters).toHaveBeenCalledExactlyOnceWith(
                'bacteria-1',
                -20,
                -18,
                [-30, -25, -40],
                64
            );
        });

        it('captures a device’s offline setup when asked, and prepares from that capture later', async () => {
            const levainPort = { postMessage: () => {} } as unknown as MessagePort;
            const controller = new AbortController();
            const device = { id: 'levain-9', type: 'levain' };
            callbackWiring.captureOfflineLevain.mockClear();
            callbackWiring.captureOfflineLevain.mockReturnValueOnce('captured-levain-state');
            prepareOfflineLevainMock.mockClear();

            const prepare = getSink().captureOfflineInstrument(device);

            expect(callbackWiring.captureOfflineLevain).toHaveBeenCalledExactlyOnceWith({
                deviceId: 'levain-9',
                device,
            });
            expect(prepareOfflineLevainMock).not.toHaveBeenCalled();

            await prepare({ port: levainPort, signal: controller.signal });

            expect(prepareOfflineLevainMock).toHaveBeenCalledExactlyOnceWith({
                deviceId: 'levain-9',
                port: levainPort,
                signal: controller.signal,
                captured: 'captured-levain-state',
            });
        });
    });

    describe('non-fatal startup probe failures', () => {
        async function bootAgain(): Promise<void> {
            vi.resetModules();
            (await import('../bootstrap')).bootstrapApplication();
        }

        beforeEach(() => {
            loggerMock.warn.mockClear();
        });

        it('warns with the error text when browser AI initialization rejects', async () => {
            initBrowserAiMock.mockImplementationOnce(() => Promise.reject(new Error('webgpu missing')));

            await bootAgain();

            await vi.waitFor(() =>
                expect(loggerMock.warn).toHaveBeenCalledWith(
                    'Browser AI initialization failed (non-fatal): Error: webgpu missing'
                )
            );
        });

        it('warns with the error text when the RAVE model probe rejects', async () => {
            initRaveModelsMock.mockImplementationOnce(() => Promise.reject(new Error('opfs unavailable')));

            await bootAgain();

            await vi.waitFor(() =>
                expect(loggerMock.warn).toHaveBeenCalledWith(
                    'RAVE model presence probe failed (non-fatal): Error: opfs unavailable'
                )
            );
        });
    });
});
