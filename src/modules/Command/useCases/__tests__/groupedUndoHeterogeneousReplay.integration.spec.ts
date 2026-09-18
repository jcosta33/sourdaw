import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore, type Track } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
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
import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type ActionUndoEntry } from '../../models/UndoEntry';
import { getCommandHandler } from '../getCommandHandler';

// #3814 — sequential single actions sharing one `groupId` form heterogeneous
// groups legitimately, and a grouped undo replays the group's inverses as one
// atomic batch newest-first. The batch preflight used to validate every member
// against the LIVE pre-batch state, while the batch's sequential execution
// gives each member the writes of its predecessors — so a member whose
// predecessors restore its preconditions (a duplicated clip a `restoreTrack`
// sibling brings back) could never pass, wrote nothing, and failed identically
// on every retry: the group was permanently un-undoable.
//
// These specs run the REAL production handlers, the REAL stores and the REAL
// undo machinery over the issue's reproduce: a clip re-homing, a clip
// duplication and a destroying track removal sharing one group. The re-homing
// action's handler ships without `validate`, so `createHandler` marks it a
// singleton and `executeAppAction` keeps its entry out of every history group;
// the grouped atomic replay is therefore the [duplicateClip, removeTrack] pair
// and the re-homing inverse replays on the following press. One gesture, and
// the undo presses must walk the whole gesture back with no conflict noise.

const SOURCE_TRACK_ID = 'track-t1';
const REMOVED_TRACK_ID = 'track-t2';
const MOVED_CLIP_ID = 'clip-c';
const SURVIVOR_CLIP_ID = 'clip-d';
const GROUP_LABEL = 'Move, duplicate, delete track';

const SOURCE_NOTES = [
    { id: 'note-c1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
    { id: 'note-c2', pitch: 64, startBeat: 1, duration: 1, velocity: 90 },
] as const;

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

/** The track lifecycle events `removeTrack`/`restoreTrack` publish post-commit
 *  through the DI-injected Arrangement bus; the fixture registers a bare one so
 *  the effects run without a bootstrapped app shell. */
type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipSeed(trackId: string, id: string, startBeat: number, endBeat: number, type: 'audio' | 'midi') {
    return {
        id,
        trackId,
        startBeat,
        endBeat,
        name: `Clip ${id}`,
        type,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
    };
}

function seedProject(options: {
    readonly sourceClipType: 'audio' | 'midi';
    readonly routeSourceToRemoved: boolean;
}): void {
    const sourceTrack: Track = {
        ...createTrack({ id: SOURCE_TRACK_ID, name: 'Source', kind: options.sourceClipType }),
        ...(options.routeSourceToRemoved ? { outputId: REMOVED_TRACK_ID } : {}),
    };
    const removedTrack = createTrack({ id: REMOVED_TRACK_ID, name: 'Removed', kind: 'audio' });
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [sourceTrack, removedTrack],
    });
    if (addClip(clipSeed(SOURCE_TRACK_ID, MOVED_CLIP_ID, 0, 4, options.sourceClipType)) === null) {
        throw new Error('Expected the moved clip fixture to seed');
    }
    if (addClip(clipSeed(REMOVED_TRACK_ID, SURVIVOR_CLIP_ID, 8, 12, 'audio')) === null) {
        throw new Error('Expected the surviving clip fixture to seed');
    }
    if (options.sourceClipType === 'midi') {
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { [MOVED_CLIP_ID]: SOURCE_NOTES.map((note) => ({ ...note })) },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    }
}

/** Dispatches the issue's gesture and returns the id the duplicate minted. */
async function dispatchGroupedGesture(groupId: string): Promise<string> {
    await executeUserAppAction(
        { type: 'moveClip', payload: { clipId: MOVED_CLIP_ID, trackId: REMOVED_TRACK_ID, startBeat: 4 } },
        { groupId, groupLabel: GROUP_LABEL }
    );
    await executeUserAppAction(
        { type: 'duplicateClip', payload: { clipId: MOVED_CLIP_ID } },
        { groupId, groupLabel: GROUP_LABEL }
    );
    const duplicateClipId = clipIdsOnTrack(REMOVED_TRACK_ID).find(
        (clipId) => clipId !== MOVED_CLIP_ID && clipId !== SURVIVOR_CLIP_ID
    );
    if (!duplicateClipId) {
        throw new Error('Expected the duplicated clip on the removed track');
    }
    await executeUserAppAction(
        { type: 'removeTrack', payload: { trackId: REMOVED_TRACK_ID } },
        { groupId, groupLabel: GROUP_LABEL }
    );
    return duplicateClipId;
}

function clipIdsOnTrack(trackId: string): readonly string[] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips.map((clip) => clip.id) ?? [];
}

function inverseOfPastAction(actionType: AppAction['type']): AppAction | null {
    const entries = undoHistoryStore.value?.past ?? [];
    for (const entry of [...entries].reverse()) {
        if (entry.kind === 'action' && entry.action.type === actionType) {
            return entry.inverseAction;
        }
    }
    return null;
}

function expectGroupedPairOnPast(groupId: string): void {
    const past = undoHistoryStore.value?.past ?? [];
    const grouped = past.filter((entry): entry is ActionUndoEntry => entry.kind === 'action');
    expect(grouped.map((entry) => [entry.action.type, entry.groupId])).toEqual([
        ['moveClip', undefined],
        ['duplicateClip', groupId],
        ['removeTrack', groupId],
    ]);
}

function expectTrackOrderAndSurvivor(movedClipBackWithTrack: boolean): void {
    expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([SOURCE_TRACK_ID, REMOVED_TRACK_ID]);
    // The surviving clip keeps its place; the moved clip returns with the
    // track the group restored, before the re-homing single replays.
    const expectedClips = movedClipBackWithTrack ? [SURVIVOR_CLIP_ID, MOVED_CLIP_ID] : [SURVIVOR_CLIP_ID];
    expect(clipIdsOnTrack(REMOVED_TRACK_ID)).toEqual(expectedClips);
}

describe('grouped undo replays mixed re-homing and destruction (#3814)', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('grouped undo heterogeneous replay integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState({ ...defaultTrackState });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('replays the whole gesture: the group undoes as one batch and the re-homing single follows', async () => {
        seedProject({ sourceClipType: 'audio', routeSourceToRemoved: false });
        const groupId = `grouped-undo-plain-${crypto.randomUUID()}`;

        await dispatchGroupedGesture(groupId);

        expect(clipIdsOnTrack(REMOVED_TRACK_ID)).toEqual([]);
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([SOURCE_TRACK_ID]);
        expectGroupedPairOnPast(groupId);

        // The full replay order `executeActionGroupUndo` would build from this
        // gesture's entries, including the re-homing single's inverse. The
        // batch preflight calls each member's `validate` against LIVE state
        // before anything runs, so the re-homing inverse — whose track only a
        // prior sibling's restore re-establishes — must pass there through its
        // projection, exactly as the two grouped members do.
        const replayInverses = [...(undoHistoryStore.value?.past ?? [])]
            .reverse()
            .flatMap((entry) => (entry.kind === 'action' && entry.inverseAction !== null ? [entry.inverseAction] : []));
        expect(replayInverses.map((action) => action.type)).toEqual([
            'restoreTrack',
            'discardDuplicatedClip',
            'restoreClipPlacement',
        ]);
        for (const [actionIndex, action] of replayInverses.entries()) {
            const handler = getCommandHandler(action);
            if (!handler?.validate) {
                throw new Error(`Expected a validating handler for ${action.type}`);
            }
            expect(handler.validate(action, { actions: replayInverses, actionIndex })).toBe(true);
        }

        // First press: the grouped pair replays as ONE atomic batch — the
        // track (carrying the moved clip) comes back and the duplicate is
        // dropped — and the group is consumed whole.
        await expect(undo()).resolves.toEqual({ headConsumed: true });

        expect(notifications).toEqual([]);
        expectTrackOrderAndSurvivor(true);
        expect(clipIdsOnTrack(SOURCE_TRACK_ID)).toEqual([]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        // Second press: the re-homing single (never grouped — its handler is
        // a singleton batch) replays the clip's original placement.
        await expect(undo()).resolves.toEqual({ headConsumed: true });

        expect(notifications).toEqual([]);
        expect(clipIdsOnTrack(SOURCE_TRACK_ID)).toEqual([MOVED_CLIP_ID]);
        const restoredClip = trackStore.value?.tracks
            .find((track) => track.id === SOURCE_TRACK_ID)
            ?.clips.find((clip) => clip.id === MOVED_CLIP_ID);
        expect(restoredClip).toMatchObject({ trackId: SOURCE_TRACK_ID, startBeat: 0, endBeat: 4 });
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(3);
    });

    it('replays the whole gesture when the duplicate carries generated MIDI state', async () => {
        seedProject({ sourceClipType: 'midi', routeSourceToRemoved: false });
        const groupId = `grouped-undo-generated-${crypto.randomUUID()}`;

        const duplicateClipId = await dispatchGroupedGesture(groupId);

        // The duplicate's inverse carries a generated-MIDI guard over the
        // copied notes — the leg the restoreTrack sibling used to break.
        const discardInverse = inverseOfPastAction('duplicateClip');
        expect(discardInverse?.type).toBe('discardDuplicatedClip');
        expect(
            discardInverse?.type === 'discardDuplicatedClip'
                ? discardInverse.payload.generatedMidiStateGuard
                : undefined
        ).toBeDefined();
        expectGroupedPairOnPast(groupId);

        await expect(undo()).resolves.toEqual({ headConsumed: true });

        expect(notifications).toEqual([]);
        expectTrackOrderAndSurvivor(true);
        expect(clipIdsOnTrack(SOURCE_TRACK_ID)).toEqual([]);
        // The duplicate's MIDI data is gone; the moved clip's notes came back
        // with the restored track.
        expect(midiStore.value?.notesByClipId[duplicateClipId]).toBeUndefined();
        expect(midiStore.value?.notesByClipId[MOVED_CLIP_ID]).toEqual(SOURCE_NOTES.map((note) => ({ ...note })));
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        await expect(undo()).resolves.toEqual({ headConsumed: true });

        expect(notifications).toEqual([]);
        expect(clipIdsOnTrack(SOURCE_TRACK_ID)).toEqual([MOVED_CLIP_ID]);
        expectTrackOrderAndSurvivor(false);
        // The source clip's notes are exactly what they were before the
        // gesture — untouched by the duplicate's discard.
        expect(midiStore.value?.notesByClipId[MOVED_CLIP_ID]).toEqual(SOURCE_NOTES.map((note) => ({ ...note })));
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(3);
    });

    it('refuses honestly when an external edit diverges the restored-track routing expectation', async () => {
        seedProject({ sourceClipType: 'audio', routeSourceToRemoved: true });
        const groupId = `grouped-undo-diverged-${crypto.randomUUID()}`;

        await dispatchGroupedGesture(groupId);

        expectGroupedPairOnPast(groupId);
        // removeTrack reconciled the source track's output away from the
        // removed id. An external edit (no undo entry — a peer sync, not a
        // local gesture) moves it again, so the group's restoreTrack inverse
        // can no longer honestly re-establish its captured routing.
        const store = trackStore.value;
        if (!store) {
            throw new Error('Expected the track store to be initialized');
        }
        const reconciledOutputId = store.tracks.find((track) => track.id === SOURCE_TRACK_ID)?.outputId;
        if (!reconciledOutputId || reconciledOutputId === REMOVED_TRACK_ID) {
            throw new Error('Expected removeTrack to have reconciled the source routing');
        }
        setTrackStoreState({
            ...store,
            tracks: store.tracks.map((track) =>
                track.id === SOURCE_TRACK_ID ? { ...track, outputId: 'hw_out' } : track
            ),
        });

        await expect(undo()).resolves.toEqual({ headConsumed: false });

        // Nothing applied, the group stays on `past` retryable, and the
        // conflict is reported by name.
        expect(notifications).toEqual([
            { message: `Cannot undo "${GROUP_LABEL}": project state has changed`, level: 'warning' },
        ]);
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([SOURCE_TRACK_ID]);
        expect(clipIdsOnTrack(SOURCE_TRACK_ID)).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === SOURCE_TRACK_ID)?.outputId).toBe('hw_out');
        expectGroupedPairOnPast(groupId);
        expect(undoHistoryStore.value?.future).toEqual([]);
    });
});
