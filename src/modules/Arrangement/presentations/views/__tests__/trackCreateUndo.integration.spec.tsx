import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { TrackContextMenu } from '../TrackContextMenu';
import { TrackListView } from '../TrackListView';

/**
 * Creating a track or a clip from the menus must be undoable.
 *
 * The track-list "+" menu created tracks through the bare `addTrack` use case
 * and the track context menu created clips through the bare `addClip` use
 * case. Neither captures an inverse, so action history stayed empty and the
 * created entity was unrecoverable while the identical AI-driven create stayed
 * undoable (issue #3696). Both gestures now dispatch the registered actions,
 * whose handlers describe exact inverses: `discardCreatedTrack` removes
 * precisely the created track, `addClip`'s discard inverse removes precisely
 * the created clip, and redo restores each with its stable id.
 *
 * The observable is the project itself: create through the menu, undo, and the
 * entity is gone with prior history intact; redo and it is back with the same
 * id. Everything under the click is real — the Arrangement handler map,
 * `executeAppAction`, a real Automerge document, the real undo stack. Stubbed
 * seams this assertion does not read: `confirmUser`,
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
// create/undo-graph importer of AiRuntime/useCases.
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
// barrel — Arrangement handler/use-case wiring (addTrack, clip
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
    saveProjectBeforeReplacement: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    writeNativeBuiltinParameters: vi.fn(),
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
    soundsNativeNotes: () => false,
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
 * The create/discard handlers publish `track.added` / `track.removed` through
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

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const SEED_TRACK_ID = 'seed-track';
const SEED_COLOR = '#ff0000';
const PRIOR_COLOR = '#00ff00';

function seedProject(): void {
    trackStore.set({
        tracks: [TrackDummy.create({ id: SEED_TRACK_ID, name: 'Seeds', kind: 'audio', color: SEED_COLOR })],
        selectedTrackId: SEED_TRACK_ID,
        ghostClips: [],
    });
}

function trackIds(): string[] {
    return (trackStore.value?.tracks ?? []).map((track) => track.id);
}

function clipsOnTrack(trackId: string): Array<{ id: string; startBeat: number; endBeat: number }> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return (track?.clips ?? []).map((clip) => ({ id: clip.id, startBeat: clip.startBeat, endBeat: clip.endBeat }));
}

async function openAddTrackMenuAndCreateAudioTrack(): Promise<void> {
    render(
        <TooltipProvider>
            <TrackListView />
        </TooltipProvider>
    );
    // Radix DropdownMenu triggers open on pointerdown (see the components/ui
    // dropdown-menu spec for the canonical jsdom probe).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add track' }), { pointerId: 1 });
    await vi.waitFor(() => {
        expect(screen.getByTestId('add-track-audio')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('add-track-audio'));
}

async function addClipThroughContextMenu(): Promise<void> {
    const track = trackStore.value!.tracks.find((candidate) => candidate.id === SEED_TRACK_ID)!;
    render(
        <TooltipProvider>
            <TrackContextMenu track={track}>
                <div data-testid="track-row">Seeds</div>
            </TrackContextMenu>
        </TooltipProvider>
    );
    fireEvent.contextMenu(screen.getByTestId('track-row'));
    fireEvent.click(screen.getByText('Add Clip'));
}

describe('creating entities from the menus', () => {
    let notifications: NotifyPayload[];

    beforeEach(() => {
        vi.clearAllMocks();
        // `inject` caches the resolved factory on first call, so a bus set in a
        // previous test would stay captured by `notifyUser`/`publishTrackAdded`
        // even after `Container.set` swaps the registration. Clearing the
        // container (the handleAddClip integration pattern) drops the cache
        // before the fresh buses are registered below.
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('track create undo');
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
        agentProjectRepairStateStore.set(null);
        seedProject();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        agentProjectRepairStateStore.set(null);
        Container.clear();
    });

    it('undoes the add-track menu create by removing precisely the created track, and redo restores its id', async () => {
        // A prior entry proves the create pushes its own entry instead of
        // truncating or replacing existing history.
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: SEED_TRACK_ID, color: PRIOR_COLOR } });
        expect(undoStore.value?.past).toHaveLength(1);

        await openAddTrackMenuAndCreateAudioTrack();

        let createdTrackId = '';
        await vi.waitFor(() => {
            const ids = trackIds();
            expect(ids).toHaveLength(2);
            createdTrackId = ids.find((id) => id !== SEED_TRACK_ID) ?? '';
            expect(createdTrackId).not.toBe('');
        });
        const createdTrack = trackStore.value?.tracks.find((candidate) => candidate.id === createdTrackId);
        if (!createdTrack) {
            throw new Error('Expected the menu-created track to exist');
        }
        expect(createdTrack.name).toMatch(/^Audio \d+$/);
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();

        // Precisely the created track is gone; the seed track is untouched.
        expect(trackIds()).toEqual([SEED_TRACK_ID]);
        expect(undoStore.value?.past).toHaveLength(1);

        await redo();

        const restored = trackStore.value?.tracks.find((candidate) => candidate.id === createdTrackId);
        expect(trackIds()).toEqual([SEED_TRACK_ID, createdTrackId]);
        expect(restored?.name).toBe(createdTrack.name);
        expect(restored?.color).toBe(createdTrack.color);
        expect(restored?.kind).toBe('audio');

        // The prior entry survived the create round trip: a second undo steps
        // past the create into the color change rather than hitting a stack
        // that the create truncated.
        await undo();
        await undo();
        const seed = trackStore.value?.tracks.find((candidate) => candidate.id === SEED_TRACK_ID);
        expect(trackIds()).toEqual([SEED_TRACK_ID]);
        expect(seed?.color).toBe(SEED_COLOR);
    });

    it('undoes the Add Clip menu create by removing precisely the created clip, and redo restores its id', async () => {
        await addClipThroughContextMenu();

        let createdClipId = '';
        await vi.waitFor(() => {
            const clips = clipsOnTrack(SEED_TRACK_ID);
            expect(clips).toHaveLength(1);
            createdClipId = clips[0]!.id;
        });
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();

        expect(clipsOnTrack(SEED_TRACK_ID)).toEqual([]);

        await redo();

        expect(clipsOnTrack(SEED_TRACK_ID)).toEqual([{ id: createdClipId, startBeat: 0, endBeat: 16 }]);
    });

    it('warns instead of writing when the add-track gesture fires on a repair-required project', async () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });

        await openAddTrackMenuAndCreateAudioTrack();

        await vi.waitFor(() => {
            expect(notifications).toHaveLength(1);
        });
        expect(notifications[0]?.level).toBe('warning');
        expect(trackIds()).toEqual([SEED_TRACK_ID]);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('warns instead of writing when the Add Clip gesture fires on a repair-required project', async () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });

        await addClipThroughContextMenu();

        await vi.waitFor(() => {
            expect(notifications).toHaveLength(1);
        });
        expect(notifications[0]?.level).toBe('warning');
        expect(clipsOnTrack(SEED_TRACK_ID)).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
