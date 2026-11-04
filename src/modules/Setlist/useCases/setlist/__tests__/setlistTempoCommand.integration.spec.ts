import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { type Clip, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
    hasCrdtDoc,
    mutateCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { setlistStore, type SetlistItem, type SetlistState } from '#/modules/Setlist/stores';
import { getSetlistHandlers, goToItem, reorderSetlistItems, updateSetlistItem } from '#/modules/Setlist/useCases';
import {
    defaultTransportState,
    playheadPositionRef,
    readSecondsAtBeat,
    readTempoAtBeat,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';

import { advanceSetlistItemEnd } from '../advanceSetlistItemEnd';

const BASE_BPM = 80;
const LEGACY_AUDIO_OFFSET_BEATS = 8;
type StoragePort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function currentSetlist(): SetlistState {
    const state = setlistStore.value;
    if (!state) {
        throw new Error('Expected the initialized setlist state');
    }
    return state;
}

function controlledStoragePort(waitForSnapshotTransaction: () => Promise<void>): StoragePort {
    return {
        getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
        getSemanticMessage: () => undefined,
        hasDoc: hasCrdtDoc,
        mutateDoc: ({ docId, changedKeys, changeFn, message, snapshotTransaction }) =>
            mutateCrdtDoc<Record<string, unknown>>({
                id: docId,
                changeFn,
                message,
                snapshotTransaction,
                localSlots: changedKeys,
            }),
        waitForSnapshotTransaction,
    };
}

function clip(id: string, trackId: string, type: Clip['type'], startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId,
        type,
        startBeat,
        endBeat,
        name: id,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        fadeInBeats: 0,
        fadeOutBeats: 0,
    };
}

function installProject(): void {
    trackStore.set({
        tracks: [
            normalizeTrack({
                id: 'audio',
                name: 'Slipped phrase',
                kind: 'audio',
                clips: [
                    {
                        ...clip('source', 'audio', 'audio', 0, 12),
                        audioBufferId: 'legacy-phrase',
                        audioOffsetBeats: LEGACY_AUDIO_OFFSET_BEATS,
                    },
                ],
            }),
        ],
        selectedTrackId: 'audio',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function sourceEntrySeconds(): number {
    const track = trackStore.value!.tracks.find((candidate) => candidate.id === 'audio');
    if (!track) {
        throw new Error('Expected the phrase track');
    }
    const source = resolveClipsWithComping(track.id, track.clips).find((candidate) => candidate.id === 'source');
    if (!source) {
        throw new Error('Expected the resolved phrase');
    }
    const segment = projectAudioLoopPassSegments({
        clip: source,
        loopLengthBeats: source.endBeat - source.startBeat,
        iterationStartBeat: source.startBeat,
        iterationEndBeat: source.endBeat,
        stretchRatio: 1,
        tempoAtClipStart: readTempoAtBeat({ beat: source.startBeat }),
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    })[0];
    if (!segment) {
        throw new Error('Expected a production source interval');
    }
    return segment.sourceStartSeconds;
}

function projectAuthorityMatchesStores(): void {
    flushAutomergeStorageWrites();
    const publishedTracks = structuredClone(trackStore.value!.tracks);
    for (const track of publishedTracks) {
        // Projection defaults name these absent keys; the durable document does not.
        if (track.frozenBufferId === undefined) {
            delete track.frozenBufferId;
        }
        if (track.showVariationLanes === undefined) {
            delete track.showVariationLanes;
        }
    }
    expect(getCrdtDoc('root')).toMatchObject({
        transport: {
            tempo: transportStore.value!.tempo,
            timeSignatureNumerator: transportStore.value!.timeSignatureNumerator,
            timeSignatureDenominator: transportStore.value!.timeSignatureDenominator,
        },
        tracks: { tracks: publishedTracks },
        tempoMap: tempoMapStore.value,
    });
}

function song(overrides: Partial<SetlistItem> = {}): SetlistItem {
    return {
        id: 'item-1',
        name: 'Song',
        projectPath: null,
        bpm: 160,
        timeSignature: { numerator: 3, denominator: 4 },
        estimatedDuration: 120,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: false,
        gapSeconds: 0,
        markers: [],
        ...overrides,
    };
}

describe('Setlist transport changes use guarded project actions', () => {
    let disposeProjection: (() => void) | undefined;
    let eventBus: { emit: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        Container.clear();
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Setlist tempo command integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, tempo: BASE_BPM });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        playheadPositionRef.current = Number.POSITIVE_INFINITY;
        advanceSetlistItemEnd();
        playheadPositionRef.current = 0;
        installProject();
        disposeProjection = setupProjectionBridge();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        registerHandlerMap(getSetlistHandlers());
        eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
        injectDependencies(goToItem, {
            eventBus,
            setlistStore,
        });
        setlistStore.set({
            name: 'Set',
            items: [song()],
            currentIndex: -1,
            autoAdvance: false,
            countInBars: 1,
        });
    });

    afterEach(() => {
        disposeProjection?.();
        disposeProjection = undefined;
        clearUndoHistory();
        clearHandlerRegistry();
        setlistStore.set({
            name: 'Untitled Setlist',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        });
        transportStore.set(structuredClone(defaultTransportState));
        playheadPositionRef.current = Number.POSITIVE_INFINITY;
        advanceSetlistItemEnd();
        vi.clearAllTimers();
        vi.useRealTimers();
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('preserves the slipped phrase and groups BPM and meter into one undoable transition', async () => {
        expect(sourceEntrySeconds()).toBe((LEGACY_AUDIO_OFFSET_BEATS * 60) / BASE_BPM);

        await goToItem(0);

        expect(sourceEntrySeconds()).toBe(6);
        projectAuthorityMatchesStores();
        expect(currentSetlist().currentIndex).toBe(0);
        expect(transportStore.value!.tempo).toBe(160);
        expect(transportStore.value!.timeSignatureNumerator).toBe(3);
        expect(transportStore.value!.timeSignatureDenominator).toBe(4);
        const history = undoHistoryStore.value?.past ?? [];
        expect(history).toHaveLength(2);
        expect(history[0]?.groupId).toEqual(expect.any(String));
        expect(new Set(history.map((entry) => entry.groupId))).toEqual(new Set([history[0]?.groupId]));
        expect(history[0]?.groupLabel).toBe('Setlist: Song');

        expect((await undo()).headConsumed).toBe(true);
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(BASE_BPM);
        expect(transportStore.value!.timeSignatureNumerator).toBe(4);
        expect(transportStore.value!.timeSignatureDenominator).toBe(4);
        expect(currentSetlist().currentIndex).toBe(0);
        expect(sourceEntrySeconds()).toBe(6);

        await redo();
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(160);
        expect(transportStore.value!.timeSignatureNumerator).toBe(3);
        expect(transportStore.value!.timeSignatureDenominator).toBe(4);
        expect(currentSetlist().currentIndex).toBe(0);
        expect(sourceEntrySeconds()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
    });

    it('awaits the registered next and previous actions through their transport commits', async () => {
        setlistStore.set({
            name: 'Set',
            items: [
                song({ id: 'first', bpm: 100, timeSignature: { numerator: 5, denominator: 8 } }),
                song({ id: 'second', bpm: 160, timeSignature: { numerator: 3, denominator: 4 } }),
            ],
            currentIndex: 1,
            autoAdvance: false,
            countInBars: 1,
        });

        await executeAppAction({ type: 'previousSetlistItem', payload: undefined });
        expect(currentSetlist().currentIndex).toBe(0);
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(100);
        expect(transportStore.value!.timeSignatureNumerator).toBe(5);
        expect(transportStore.value!.timeSignatureDenominator).toBe(8);
        expect(sourceEntrySeconds()).toBe(6);

        await executeAppAction({ type: 'nextSetlistItem', payload: undefined });
        expect(currentSetlist().currentIndex).toBe(1);
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(160);
        expect(transportStore.value!.timeSignatureNumerator).toBe(3);
        expect(transportStore.value!.timeSignatureDenominator).toBe(4);
        expect(sourceEntrySeconds()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(4);
        expect(new Set(undoHistoryStore.value?.past.map((entry) => entry.groupId)).size).toBe(2);
    });

    it('does not apply a held transition after a newer song is selected', async () => {
        let releaseFirstTransition!: () => void;
        let markFirstTransitionHeld!: () => void;
        const held = new Promise<void>((resolve) => {
            releaseFirstTransition = resolve;
        });
        const firstTransitionHeld = new Promise<void>((resolve) => {
            markFirstTransitionHeld = resolve;
        });
        let holdNextTransition = true;
        configureAutomergeStoragePort(
            controlledStoragePort(async () => {
                if (holdNextTransition) {
                    holdNextTransition = false;
                    markFirstTransitionHeld();
                    await held;
                }
            })
        );
        setlistStore.set({
            name: 'Set',
            items: [
                song({ id: 'stale', bpm: 120, programChange: { channel: 1, program: 10 } }),
                song({ id: 'current', bpm: 160, timeSignature: { numerator: 3, denominator: 4 } }),
            ],
            currentIndex: -1,
            autoAdvance: false,
            countInBars: 1,
        });

        const staleNavigation = goToItem(0);
        await firstTransitionHeld;
        expect(currentSetlist().currentIndex).toBe(0);
        const currentNavigation = goToItem(1);
        await currentNavigation;
        releaseFirstTransition();
        await staleNavigation;

        expect(currentSetlist().currentIndex).toBe(1);
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(160);
        expect(transportStore.value!.timeSignatureNumerator).toBe(3);
        expect(sourceEntrySeconds()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('keeps a held transition through selected song rename and reorder', async () => {
        let releaseFirstTransition!: () => void;
        let markFirstTransitionHeld!: () => void;
        const held = new Promise<void>((resolve) => {
            releaseFirstTransition = resolve;
        });
        const firstTransitionHeld = new Promise<void>((resolve) => {
            markFirstTransitionHeld = resolve;
        });
        let holdNextTransition = true;
        configureAutomergeStoragePort(
            controlledStoragePort(async () => {
                if (holdNextTransition) {
                    holdNextTransition = false;
                    markFirstTransitionHeld();
                    await held;
                }
            })
        );
        setlistStore.set({
            name: 'Set',
            items: [song({ id: 'selected', name: 'Before rename' }), song({ id: 'other', bpm: 100 })],
            currentIndex: -1,
            autoAdvance: false,
            countInBars: 1,
        });

        const navigation = goToItem(0);
        await firstTransitionHeld;
        updateSetlistItem('selected', { name: 'After rename' });
        reorderSetlistItems(0, 1);
        releaseFirstTransition();
        await navigation;

        expect(currentSetlist().currentIndex).toBe(1);
        expect(currentSetlist().items[1]?.name).toBe('After rename');
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(160);
        expect(transportStore.value!.timeSignatureNumerator).toBe(3);
        expect(transportStore.value!.timeSignatureDenominator).toBe(4);
        expect(sourceEntrySeconds()).toBe(6);
        const projectHistory = undoHistoryStore.value?.past.filter(
            (entry) =>
                entry.kind === 'action' &&
                (entry.action.type === 'setTempo' || entry.action.type === 'setTimeSignature')
        );
        expect(projectHistory).toHaveLength(2);
        expect(new Set(projectHistory?.map((entry) => entry.groupId)).size).toBe(1);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('auto-advances through the registered transport command after the configured gap', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        setlistStore.set({
            name: 'Set',
            items: [
                song({ id: 'first', estimatedDuration: 4, gapSeconds: 2 }),
                song({ id: 'second', bpm: 160, timeSignature: { numerator: 3, denominator: 4 } }),
            ],
            currentIndex: 0,
            autoAdvance: true,
            countInBars: 1,
        });
        transportStore.set({ ...defaultTransportState, tempo: BASE_BPM });
        playheadPositionRef.current = 0;
        advanceSetlistItemEnd();
        transportStore.set({ ...defaultTransportState, tempo: BASE_BPM, isPlaying: true });
        advanceSetlistItemEnd();
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        await vi.advanceTimersByTimeAsync(1999);
        expect(currentSetlist().currentIndex).toBe(0);
        await vi.advanceTimersByTimeAsync(1);

        expect(currentSetlist().currentIndex).toBe(1);
        projectAuthorityMatchesStores();
        expect(transportStore.value!.tempo).toBe(160);
        expect(transportStore.value!.timeSignatureNumerator).toBe(3);
        expect(sourceEntrySeconds()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
    });
});
