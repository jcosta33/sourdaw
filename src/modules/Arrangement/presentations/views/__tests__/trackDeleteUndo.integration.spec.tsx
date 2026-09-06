import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { TrackContextMenu } from '../TrackContextMenu';
import { TrackListView } from '../TrackListView';

/**
 * Deleting a track from the UI must be undoable.
 *
 * The app has two delete gestures for a track — the context menu's "Delete
 * Track" and the Delete/Backspace key on the track list — and an undoable
 * `removeTrack` *action* whose handler snapshots the clips, devices, routing,
 * automation lanes, MIDI and takes so `restoreTrack` can replay them. Both
 * gestures called the bare `removeTrack` use case instead, which captures
 * nothing, so a track (and everything on it) left the project unrecoverably
 * while the identical AI-driven delete stayed undoable.
 *
 * The observable is the project itself: delete, press undo, and the track is
 * back with its clip still on it. Everything under the click is real — the
 * Arrangement handler map, `executeAppAction`, a real Automerge document, the
 * real undo stack. Stubbed seams this assertion does not read: `confirmUser`,
 * `useContextMenuDismiss`, AiRuntime `injectPromptDraft`, the AudioEngine
 * use-case surface, Routing sidechain/send fan-out, and
 * `projectTrackToLiveStrip`.
 *
 * Graph-cut (non-spread listings, not fake handler maps): AiRuntime/useCases,
 * WorkspaceShell/useCases, MIDI/useCases, Yeast/useCases, and Knead/useCases.
 * WorkspaceShell setWorkspaceMode (TrackListView) and setSoloMode
 * (resetPreferences/updatePreferences), the MIDI/useCases barrel names the
 * remaining graph imports, Yeast `hydrateYeastCrdtProjection`, and Knead
 * pitch-analysis hydration return live `actual.*`; AiRuntime lists only the
 * stubbed `injectPromptDraft`. `getArrangementHandlers` / `setArrangementEventBus`
 * stay live via relative imports.
 */

vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));
vi.mock('#/utils/UI/useContextMenuDismiss', () => ({ useContextMenuDismiss: vi.fn() }));
// Non-spread listing of injectPromptDraft — TrackListView is the only
// delete/undo-graph importer of AiRuntime/useCases.
vi.mock('#/modules/AiRuntime/useCases', () => ({
    injectPromptDraft: vi.fn(),
}));
// Non-spread listing: TrackListView imports setWorkspaceMode;
// resetPreferences and updatePreferences import setSoloMode.
vi.mock('#/modules/WorkspaceShell/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/WorkspaceShell/useCases')>(
        '#/modules/WorkspaceShell/useCases'
    );
    return {
        setSoloMode: actual.setSoloMode,
        setWorkspaceMode: actual.setWorkspaceMode,
    };
});
// Non-spread listing of MIDI names the remaining graph imports through the
// barrel — Arrangement handler/use-case wiring (removeTrack, armTrack, clip
// glue/split, handleDiscardDuplicatedClip, freeze bounce, …) and CrdtDocument
// `prepareDrumPreviewBranches` for `projectDrumPreviewCandidateNotes`.
vi.mock('#/modules/MIDI/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/MIDI/useCases')>('#/modules/MIDI/useCases');
    return {
        adaptGrooveTemplateForConsumer: vi.fn(),
        appendMidiNotes: vi.fn(),
        arpeggiate: actual.arpeggiate,
        canPrepareMidiClipGlueState: vi.fn(),
        downloadMidiFile: actual.downloadMidiFile,
        duplicateClipNotes: actual.duplicateClipNotes,
        duplicateMidiClipData: actual.duplicateMidiClipData,
        getGrooveTemplate: vi.fn(),
        getMidiInputTrack: actual.getMidiInputTrack,
        getMidiInputTrackOwnerId: actual.getMidiInputTrackOwnerId,
        getMidiInputTrackRevision: actual.getMidiInputTrackRevision,
        getMidiStoreState: actual.getMidiStoreState,
        getScopedGrooveAssignment: vi.fn(),
        getScopedGrooveConsumerId: vi.fn(),
        getStraightGrooveTemplateId: vi.fn(),
        hasActiveStepRecordingDependency: actual.hasActiveStepRecordingDependency,
        mergeImportedMidiClipNotes: actual.mergeImportedMidiClipNotes,
        midiClipGlueStateMatches: actual.midiClipGlueStateMatches,
        midiClipSplitStateMatches: actual.midiClipSplitStateMatches,
        prepareMidiClipGlueState: actual.prepareMidiClipGlueState,
        prepareMidiClipSplit: actual.prepareMidiClipSplit,
        projectDrumPreviewCandidateNotes: actual.projectDrumPreviewCandidateNotes,
        projectMidiNotesByClipIdThroughRestores: actual.projectMidiNotesByClipIdThroughRestores,
        readMidiFile: actual.readMidiFile,
        removeMidiClipData: actual.removeMidiClipData,
        restoreGrooveAssignment: vi.fn(),
        restoreMidiClipData: actual.restoreMidiClipData,
        restoreMidiClipGlueState: actual.restoreMidiClipGlueState,
        restoreMidiClipNotes: actual.restoreMidiClipNotes,
        restoreMidiClipSplitState: actual.restoreMidiClipSplitState,
        serializeMidiStateForClips: actual.serializeMidiStateForClips,
        setMidiInputTrack: actual.setMidiInputTrack,
        setNotesForClip: actual.setNotesForClip,
        splitMidiNotesAtBeat: actual.splitMidiNotesAtBeat,
    };
});
// Non-spread listing of hydrateYeastCrdtProjection, which projectSlotProjections
// imports — TrackListView imports no Yeast/useCases names.
vi.mock('#/modules/Yeast/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Yeast/useCases')>('#/modules/Yeast/useCases');
    return {
        hydrateYeastCrdtProjection: actual.hydrateYeastCrdtProjection,
    };
});
// Non-spread listing of hydrateKneadFromTrackStore plus pitch-analysis names
// handleReverseClip, reverseClip, and handleRestoreReversedClip import.
vi.mock('#/modules/Knead/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Knead/useCases')>('#/modules/Knead/useCases');
    return {
        captureClipPitchAnalysis: actual.captureClipPitchAnalysis,
        clearClipPitchAnalysis: actual.clearClipPitchAnalysis,
        hydrateKneadFromTrackStore: actual.hydrateKneadFromTrackStore,
        restoreClipPitchAnalysis: actual.restoreClipPitchAnalysis,
    };
});
vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: vi.fn(() => ({ isCurrent: () => true })),
    exportProjectFile: vi.fn(),
    newProject: vi.fn(),
    pickFiles: vi.fn(),
    saveProject: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    applyRuntimeGraphDelta: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(() => 0),
    getDeviceChainTailSeconds: vi.fn(() => 0),
    getLiveEngineSampleRate: vi.fn(() => 48000),
    getMasterAnalyser: vi.fn(() => null),
    getRuntimeGraphRevision: vi.fn(() => 0),
    getTrackAnalyser: vi.fn(() => null),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(() => true),
    removeBusStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    audioEngine: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Routing/useCases', () => ({
    addSidechainRoute: vi.fn(),
    addSidechainRouteSnapshot: vi.fn(),
    ensureBusStrip: vi.fn(),
    getSidechainRoutesForTrack: vi.fn(),
    getSidechainTargetCapability: vi.fn(),
    hydrateSidechainRoutes: vi.fn(),
    removeSend: vi.fn(),
    removeSidechainRoute: vi.fn(),
    removeSidechainRouteSnapshot: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setSidechainRoutes: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    wireSidechainRoutes: vi.fn(),
    // Returns the finalizer the restore handler pushes straight into its
    // post-commit effect list, so it has to be callable.
    restoreSidechainRoutes: vi.fn(() => () => undefined),
}));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: vi.fn(),
}));

/**
 * The remove/restore handlers publish `track.removed` / `track.added` through
 * the DI event bus, which only `bootstrap.ts` wires. A recording stub keeps the
 * post-commit effect list runnable without pulling the composition root in.
 */
class RecordingArrangementEventBus extends ArrangementEventBus {
    readonly emitted: string[] = [];
    emit(event: string): Promise<void> {
        this.emitted.push(event);
        return Promise.resolve();
    }
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'track-to-delete';
const OTHER_TRACK_ID = 'track-that-stays';
const CLIP_ID = 'clip-on-the-deleted-track';

function seedProject(): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: TRACK_ID,
                name: 'Lead Vocal',
                kind: 'audio',
                clips: [
                    {
                        id: CLIP_ID,
                        trackId: TRACK_ID,
                        name: 'Take 3',
                        startBeat: 12,
                        endBeat: 20,
                        type: 'audio',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#ff0000',
                        locked: false,
                        muted: false,
                    },
                ],
            }),
            TrackDummy.create({ id: OTHER_TRACK_ID, name: 'Drums', kind: 'audio' }),
        ],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
}

function trackIds(): string[] {
    return (trackStore.value?.tracks ?? []).map((track) => track.id);
}

function deletedTrackClipSpan(): Array<{ id: string; startBeat: number; endBeat: number }> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    return (track?.clips ?? []).map((clip) => ({ id: clip.id, startBeat: clip.startBeat, endBeat: clip.endBeat }));
}

describe('deleting a track from the UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('track delete undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setArrangementEventBus(new RecordingArrangementEventBus());
        vi.mocked(confirmUser).mockResolvedValue(true);
        seedProject();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('puts the track and its clip back when the context-menu delete is undone', async () => {
        const track = trackStore.value!.tracks[0]!;
        render(
            <TooltipProvider>
                <TrackContextMenu track={track}>
                    <div data-testid="track-row">Lead Vocal</div>
                </TrackContextMenu>
            </TooltipProvider>
        );

        fireEvent.contextMenu(screen.getByTestId('track-row'));
        fireEvent.click(screen.getByText('Delete Track'));

        await vi.waitFor(() => {
            expect(trackIds()).toEqual([OTHER_TRACK_ID]);
        });

        await undo();

        // Position in the track list and the clip's span are both asserted: a
        // restore that appended a bare track would satisfy "the id is back".
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
        expect(deletedTrackClipSpan()).toEqual([{ id: CLIP_ID, startBeat: 12, endBeat: 20 }]);
    });

    it('puts the track and its clip back when the Delete-key delete is undone', async () => {
        render(
            <TooltipProvider>
                <TrackListView />
            </TooltipProvider>
        );

        const selectedRow = screen.getAllByRole('row')[0]!;
        fireEvent.keyDown(selectedRow, { key: 'Delete' });

        await vi.waitFor(() => {
            expect(trackIds()).toEqual([OTHER_TRACK_ID]);
        });

        await undo();

        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
        expect(deletedTrackClipSpan()).toEqual([{ id: CLIP_ID, startBeat: 12, endBeat: 20 }]);
    });

    it('deletes nothing and records no history when the confirm is cancelled', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        const track = trackStore.value!.tracks[0]!;
        render(
            <TooltipProvider>
                <TrackContextMenu track={track}>
                    <div data-testid="track-row">Lead Vocal</div>
                </TrackContextMenu>
            </TooltipProvider>
        );

        fireEvent.contextMenu(screen.getByTestId('track-row'));
        fireEvent.click(screen.getByText('Delete Track'));

        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalled();
        });

        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);

        // Pins the negative: routing the delete through the undoable action
        // must not make a *cancelled* delete undoable-into-existence either.
        await undo();
        expect(trackIds()).toEqual([TRACK_ID, OTHER_TRACK_ID]);
    });
});
