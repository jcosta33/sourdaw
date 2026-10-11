import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
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
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type Take } from '../../../models/TakeLane';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/** The production boot sequence; re-running it is exactly what a reload does. */
function registerAndHydrateProductionHandlers(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
}

/** A loop pass as commit leaves it, held in its clip's media seconds; the minted depth is two beats a second. */
function passTake(id: string, startBeat: number, endBeat: number, depthSeconds: number, anchorSeconds: number) {
    return {
        ...createTake('clip-1', id, startBeat, endBeat, depthSeconds * 2),
        id,
        passAnchorSeconds: anchorSeconds,
        passDepthSeconds: depthSeconds,
    };
}

/** Loop [0,4) recorded from beat 0 for three passes, the first four beats comped to pass 2. */
function seedCompedLoopRecording(): void {
    const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 12 });
    const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    const takes: Take[] = [
        // At the session's 120 BPM a loop lap of 4 beats is 2 s.
        passTake('pass-1', 0, 4, 0, 0),
        passTake('pass-2', 0, 4, 2, 0),
        { ...createTake('clip-1', 'manual', 0, 12), id: 'manual' },
    ];
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
                takes,
                activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'pass-2' }],
            },
        ],
    });
    flushAutomergeStorageWrites();
}

async function dispatch(action: AppAction): Promise<void> {
    await executeAppAction(action);
    flushAutomergeStorageWrites();
}

function readTakes(): Take[] {
    return structuredClone(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes) ?? []);
}

/** What the track sounds: each fragment's span and the media beat it enters at. */
function resolvedComp(): { startBeat: number; endBeat: number; mediaBeat: number }[] {
    const clips = trackStore.value?.tracks[0]?.clips ?? [];
    return resolveClipsWithComping('track-1', clips).map((fragment) => ({
        startBeat: fragment.startBeat,
        endBeat: fragment.endBeat,
        mediaBeat: fragment.audioOffsetBeats ?? 0,
    }));
}

function mirroredPast(): { action: AppAction; inverseAction: AppAction | null }[] {
    const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
    if (raw === null) {
        return [];
    }
    const parsed = JSON.parse(raw) as { past?: { action: AppAction; inverseAction: AppAction | null }[] };
    return parsed.past ?? [];
}

const asRecorded = [
    { startBeat: 0, endBeat: 4, mediaBeat: 4 },
    { startBeat: 4, endBeat: 12, mediaBeat: 4 },
];

describe('clip edits on a comped loop recording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('comped loop recording clip edits integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        registerAndHydrateProductionHandlers();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        seedCompedLoopRecording();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('sounds the comp as recorded', () => {
        expect(resolvedComp()).toEqual(asRecorded);
    });

    it.each([
        {
            name: 'moved',
            action: { type: 'moveClip', payload: { clipId: 'clip-1', trackId: 'track-1', startBeat: 8 } },
        },
        { name: 'nudged', action: { type: 'nudgeClip', payload: { clipId: 'clip-1', beats: 8 } } },
    ] satisfies { name: string; action: AppAction }[])(
        'sounds nothing outside the clip once it is $name off the comped span, without touching a take',
        async ({ action }) => {
            const takes = readTakes();

            await dispatch(action);

            expect(resolvedComp()).toEqual([{ startBeat: 8, endBeat: 20, mediaBeat: 0 }]);
            expect(readTakes()).toEqual(takes);

            await undo();
            flushAutomergeStorageWrites();
            expect(resolvedComp()).toEqual(asRecorded);
        }
    );

    it('keeps the comped pass on its clip when the clip moves under the comp', async () => {
        await dispatch({ type: 'moveClip', payload: { clipId: 'clip-1', trackId: 'track-1', startBeat: 2 } });

        expect(resolvedComp()).toEqual([
            { startBeat: 2, endBeat: 4, mediaBeat: 4 },
            { startBeat: 4, endBeat: 14, mediaBeat: 2 },
        ]);
    });

    it('shifts the comped pass with content slipped inside the clip', async () => {
        await dispatch({ type: 'slipClipContent', payload: { clipId: 'clip-1', clipType: 'audio', offset: 1 } });

        expect(resolvedComp()).toEqual([
            { startBeat: 0, endBeat: 4, mediaBeat: 5 },
            { startBeat: 4, endBeat: 12, mediaBeat: 5 },
        ]);
    });

    it('restores the comp exactly when the start is trimmed later and back, and through undo and redo', async () => {
        const takes = readTakes();
        const trimmed = [
            { startBeat: 2, endBeat: 4, mediaBeat: 6 },
            { startBeat: 4, endBeat: 12, mediaBeat: 4 },
        ];

        await dispatch({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 2 } });
        expect(resolvedComp()).toEqual(trimmed);

        await dispatch({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 0 } });
        expect(resolvedComp()).toEqual(asRecorded);
        expect(readTakes()).toEqual(takes);

        await undo();
        flushAutomergeStorageWrites();
        expect(resolvedComp()).toEqual(trimmed);
        await undo();
        flushAutomergeStorageWrites();
        expect(resolvedComp()).toEqual(asRecorded);

        await redo();
        flushAutomergeStorageWrites();
        expect(resolvedComp()).toEqual(trimmed);
        await redo();
        flushAutomergeStorageWrites();
        expect(resolvedComp()).toEqual(asRecorded);
        expect(readTakes()).toEqual(takes);
    });

    it('keeps every trim of a comped clip in the session mirror and undoes it after a reload', async () => {
        await dispatch({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 2 } });
        await dispatch({ type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 1 } });
        await vi.waitFor(() => expect(mirroredPast()).toHaveLength(2));

        expect(mirroredPast().map((entry) => [entry.action, entry.inverseAction])).toEqual([
            [
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 2 } },
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 0 } },
            ],
            [
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 1 } },
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 2 } },
            ],
        ]);

        registerAndHydrateProductionHandlers();
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(2);

        await undo();
        flushAutomergeStorageWrites();
        await undo();
        flushAutomergeStorageWrites();
        expect(resolvedComp()).toEqual(asRecorded);
    });
});
