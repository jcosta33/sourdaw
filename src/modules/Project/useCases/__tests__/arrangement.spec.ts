import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { stopPlayback } from '#/modules/Transport/useCases';

import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { switchArrangement } from '../arrangement/switchArrangement';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

const { cancelPreparedBuffers, prepareCachedAudioBuffersFromIdb, publishPreparedBuffers } = vi.hoisted(() => ({
    cancelPreparedBuffers: vi.fn(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    publishPreparedBuffers: vi.fn(() => 1),
}));

// switchArrangement imports getAudioContext and prepareCachedAudioBuffersFromIdb;
// runProjectLoadTransaction.activate imports cancelPendingAudioBufferImport.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    clearReportedLatency: vi.fn(),
    createBufferSource: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    ensureTrackStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getCurrentTime: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getDrumKitByIndex: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    hasLiveNativeGraphSession: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    isDeviceCarriedByNativeSession: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(),
    nativeLiveGraphSessionSplice: vi.fn(),
    prepareCachedAudioBuffersFromIdb,
    readNativeEnginePlayheadSeconds: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    registerScheduledSource: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    repositionNativeLiveGraphSession: vi.fn(),
    resetAudioGraph: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    resumeEngine: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    scheduleClick: vi.fn(),
    scheduleFaustNote: vi.fn(),
    scheduleSendAutomation: vi.fn(),
    scheduleTrackGain: vi.fn(),
    scheduleTrackPan: vi.fn(),
    setBusGain: vi.fn(),
    setMasterGainValue: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startAudioRecording: vi.fn(),
    startInputMonitoring: vi.fn(),
    startNativeLiveGraphSession: vi.fn(),
    stopAllScheduled: vi.fn(),
    stopAudioRecording: vi.fn(),
    stopInputMonitoring: vi.fn(),
    stopNativeLiveGraphSession: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    updateNativeLiveGraphSessionTransportMaps: vi.fn(),
    wireSidechainRoute: vi.fn(),
}));

// switchArrangement imports stopPlayback; loadSnapshot imports restoreTimelineMapSnapshot.
vi.mock('#/modules/Transport/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Transport/useCases')>('#/modules/Transport/useCases');
    return {
        stopPlayback: vi.fn(),
        restoreTimelineMapSnapshot: actual.restoreTimelineMapSnapshot,
    };
});
vi.mock('../projectPersistence/saveProject/markDirty', () => ({ markDirty: vi.fn() }));
// switchArrangement imports clearUndoHistory; runProjectLoadTransaction.prepare imports resetActionReplayAuthority; executeAppAction is listed for live Transport/Arrangement barrel load, not switchArrangement; executeUserAppAction is stubbed for the same barrel load and never dispatched here.
vi.mock('#/modules/Command/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
    return {
        clearUndoHistory: vi.fn(),
        resetActionReplayAuthority: actual.resetActionReplayAuthority,
        executeAppAction: actual.executeAppAction,
        executeAppActionBatch: vi.fn(),
        executeUserAppAction: vi.fn(),
        isAppActionCommittedError: vi.fn(),
        pushUndoEntry: vi.fn(),
        REDO_NOT_APPLIED: vi.fn(),
        syncActionReplayMetadata: vi.fn(),
    };
});
// loadSnapshot imports restoreTrackSnapshot and restoreArrangementMetadataSnapshot.
vi.mock('#/modules/Arrangement/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Arrangement/useCases')>(
        '#/modules/Arrangement/useCases'
    );
    return {
        acceptsExternalPluginAutomationParameter: vi.fn(),
        addTake: vi.fn(),
        addTakeLane: vi.fn(),
        applySoloLogic: vi.fn(),
        clampDeviceParameterValue: vi.fn(),
        clampExternalPluginAutomationValue: vi.fn(),
        getEffectiveGain: vi.fn(),
        getGainAtBeat: vi.fn(),
        getSynthParamsForTrack: vi.fn(),
        getTrackStoreState: vi.fn(),
        isDeviceParameterAutomatable: vi.fn(),
        projectTrackToLiveStrip: vi.fn(),
        quantiseDeviceParameterValue: vi.fn(),
        resolveClipsWithComping: vi.fn(),
        restoreArrangementMetadataSnapshot: actual.restoreArrangementMetadataSnapshot,
        restoreTrackSnapshot: actual.restoreTrackSnapshot,
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        updateClip: vi.fn(),
    };
});
// loadSnapshot imports restoreAutomationSnapshot.
vi.mock('#/modules/Automation/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Automation/useCases')>(
        '#/modules/Automation/useCases'
    );
    return {
        applyModulation: vi.fn(),
        applyModulationToEngine: vi.fn(),
        captureAutomationRecordingRollback: vi.fn(),
        clipAutomationMoveStateMatches: vi.fn(),
        duplicateClipAutomation: vi.fn(),
        duplicateClipAutomationBatch: vi.fn(),
        getAutomationLanes: vi.fn(),
        getAutomationValueAtBeat: vi.fn(),
        getClipAutomationMoveState: vi.fn(),
        getSendAutomationBusId: vi.fn(),
        isRecordingAutomation: vi.fn(),
        recordAutomationValue: vi.fn(),
        removeAutomationLane: vi.fn(),
        removeAutomationLanesForTrack: vi.fn(),
        removeMapping: vi.fn(),
        removeModulator: vi.fn(),
        resolveAutoMatchValue: vi.fn(),
        restoreAutomationLanes: vi.fn(),
        restoreAutomationSnapshot: actual.restoreAutomationSnapshot,
        restoreClipAutomationMoveState: vi.fn(),
        restoreTrackModulationReferences: vi.fn(),
        shiftClipAutomation: vi.fn(),
        startAutomationRecording: vi.fn(),
        stopAutomationRecording: vi.fn(),
    };
});
// loadSnapshot imports setMidiStoreState.
vi.mock('#/modules/MIDI/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/MIDI/useCases')>('#/modules/MIDI/useCases');
    return {
        adaptGrooveTemplateForConsumer: vi.fn(),
        appendMidiNotes: vi.fn(),
        arpeggiate: vi.fn(),
        canPrepareMidiClipGlueState: vi.fn(),
        downloadMidiFile: vi.fn(),
        duplicateClipNotes: vi.fn(),
        duplicateMidiClipData: vi.fn(),
        getChordAtBeat: vi.fn(),
        getGrooveTemplate: vi.fn(),
        getMidiInputTrack: vi.fn(),
        getMidiInputTrackOwnerId: vi.fn(),
        getMidiInputTrackRevision: vi.fn(),
        getMidiStoreState: vi.fn(),
        getScopedGrooveAssignment: vi.fn(),
        getScopedGrooveConsumerId: vi.fn(),
        getStraightGrooveTemplateId: vi.fn(),
        hasActiveStepRecordingDependency: vi.fn(),
        mergeImportedMidiClipNotes: vi.fn(),
        midiClipGlueStateMatches: vi.fn(),
        midiClipSplitStateMatches: vi.fn(),
        panicLiveNotes: vi.fn(),
        prepareMidiClipGlueState: vi.fn(),
        prepareMidiClipSplit: vi.fn(),
        projectClipMidiEvents: vi.fn(),
        projectCommittedGroove: vi.fn(),
        projectDrumPreviewCandidateNotes: vi.fn(),
        projectMidiNotesByClipIdThroughRestores: vi.fn(),
        readMidiFile: vi.fn(),
        removeMidiClipData: vi.fn(),
        resetMidiState: vi.fn(),
        resolveMidiNoteArticulationId: vi.fn(),
        restoreGrooveAssignment: vi.fn(),
        restoreMidiClipData: vi.fn(),
        restoreMidiClipGlueState: vi.fn(),
        restoreMidiClipNotes: vi.fn(),
        restoreMidiClipSplitState: vi.fn(),
        serializeMidiStateForClips: vi.fn(),
        setMidiInputTrack: vi.fn(),
        setMidiStoreState: actual.setMidiStoreState,
        setNotesForClip: vi.fn(),
        shouldPlayMidiEvent: vi.fn(),
        splitMidiNotesAtBeat: vi.fn(),
        transposeForChordTrack: vi.fn(),
    };
});

describe('switchArrangement', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        prepareCachedAudioBuffersFromIdb.mockResolvedValue({
            cancel: cancelPreparedBuffers,
            publish: publishPreparedBuffers,
        });
    });

    it('does not call transport or persistence collaborators when switching to the active arrangement', async () => {
        const arrangementId = arrangementStore.value!.activeArrangementId;
        await switchArrangement(arrangementId);

        expect(stopPlayback).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
    });

    it('waits for playback to stop before publishing and switching to a saved arrangement', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        target.tracks.tracks = [
            {
                id: 'track-1',
                name: 'Audio',
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: '#fff',
                clips: [
                    {
                        id: 'clip-1',
                        trackId: 'track-1',
                        name: 'Clip 1',
                        startBeat: 0,
                        endBeat: 1,
                        type: 'audio',
                        audioBufferId: 'target-buffer',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#fff',
                        locked: false,
                        muted: false,
                    },
                ],
                devices: [],
                sends: [],
                midiFx: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: null,
                collapsed: false,
                inputMonitoring: 'auto',
                hidden: false,
                disabled: false,
                height: 80,
                outputId: 'master',
                automationMode: 'read',
                groupId: null,
                soloSafe: false,
                notes: '',
                inputId: null,
                activeAlternativeId: 'alt-1',
                alternatives: [],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ];
        state.arrangements.push(target);
        arrangementStore.set(state);
        const setArrangement = vi.spyOn(arrangementStore, 'set');

        let completeStop: (() => void) | undefined;
        const stopCompletion = new Promise<void>((resolve) => {
            completeStop = resolve;
        });
        vi.mocked(stopPlayback).mockReturnValueOnce(stopCompletion);

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(stopPlayback).toHaveBeenCalledTimes(1));

        expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledWith(
            expect.objectContaining({ bufferIds: ['target-buffer'] })
        );
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(setArrangement).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);

        completeStop?.();
        await switching;

        expect(publishPreparedBuffers).toHaveBeenCalledTimes(1);
        expect(vi.mocked(stopPlayback).mock.invocationCallOrder[0]).toBeLessThan(
            publishPreparedBuffers.mock.invocationCallOrder[0]!
        );
        expect(setArrangement).toHaveBeenCalledTimes(2);
        expect(arrangementStore.value?.activeArrangementId).toBe(target.id);
    });

    it('propagates a playback stop failure without mutating the arrangement', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        const stopError = new Error('recording flush failed');
        vi.mocked(stopPlayback).mockRejectedValueOnce(stopError);

        await expect(switchArrangement(target.id)).rejects.toBe(stopError);

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(cancelPreparedBuffers).toHaveBeenCalledOnce();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a switch that becomes stale while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        let completeStop: (() => void) | undefined;
        const stopCompletion = new Promise<void>((resolve) => {
            completeStop = resolve;
        });
        vi.mocked(stopPlayback).mockReturnValueOnce(stopCompletion);

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(stopPlayback).toHaveBeenCalledTimes(1));
        await switchArrangement(state.activeArrangementId);

        completeStop?.();
        await switching;

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(cancelPreparedBuffers).toHaveBeenCalledOnce();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a switch when a project load activates while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);
        const setArrangement = vi.spyOn(arrangementStore, 'set');

        vi.mocked(stopPlayback).mockImplementationOnce(async () => {
            const newerLoad = runProjectLoadTransaction();
            await newerLoad.prepare();
            newerLoad.activate();
        });
        // Ignore store writes from setup and the project-load transaction; only switch writes matter.
        setArrangement.mockClear();

        await switchArrangement(target.id);

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(setArrangement).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a switch when the active arrangement changes while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        vi.mocked(stopPlayback).mockImplementationOnce(async () => {
            await Promise.resolve();
            arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'switched-elsewhere' });
        });

        await switchArrangement(target.id);

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe('switched-elsewhere');
    });

    it('cancels a switch when the target arrangement is removed while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        vi.mocked(stopPlayback).mockImplementationOnce(async () => {
            await Promise.resolve();
            arrangementStore.set({
                ...arrangementStore.value!,
                arrangements: arrangementStore.value!.arrangements.filter(
                    (arrangement) => arrangement.id !== target.id
                ),
            });
        });

        await switchArrangement(target.id);

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
        expect(arrangementStore.value?.arrangements.some((arrangement) => arrangement.id === target.id)).toBe(false);
    });

    it('cancels a pending switch when another project load activates', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'same-id-in-both-projects';
        state.arrangements.push(target);
        arrangementStore.set(state);
        let completePreparation: (() => void) | undefined;
        prepareCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    completePreparation = () =>
                        resolve({ cancel: cancelPreparedBuffers, publish: publishPreparedBuffers });
                })
        );

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(completePreparation).toBeDefined());
        const newerLoad = runProjectLoadTransaction();
        await newerLoad.prepare();
        newerLoad.activate();
        completePreparation?.();
        await switching;

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a pending switch when the active arrangement is selected again', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);
        let completePreparation: (() => void) | undefined;
        prepareCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    completePreparation = () =>
                        resolve({ cancel: cancelPreparedBuffers, publish: publishPreparedBuffers });
                })
        );

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(completePreparation).toBeDefined());
        await switchArrangement(state.activeArrangementId);
        completePreparation?.();
        await switching;

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });
});
