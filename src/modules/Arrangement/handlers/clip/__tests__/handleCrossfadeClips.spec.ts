import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    clearHandlerRegistry,
    macroStore,
    registerHandlerMap,
    undoHistoryStore as undoStore,
} from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, readSecondsAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleCrossfadeClips } from '../handleCrossfadeClips';
import { handleRestoreCrossfadeClips } from '../handleRestoreCrossfadeClips';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as mapAllTracksRepo from '../../../repositories/track/mapAllTracks';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';
import type * as crossfadeModule from '../../../useCases/clipEditing/crossfadeClips';
import type * as trackStoreStateModule from '../../../useCases/getTrackStoreState';

const mocks = vi.hoisted(() => ({
    crossfadeClips: vi.fn<(typeof crossfadeModule)['crossfadeClips']>(),
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    getTrackStoreState: vi.fn<(typeof trackStoreStateModule)['getTrackStoreState']>(),
    mapAllTracks: vi.fn<(typeof mapAllTracksRepo)['mapAllTracks']>(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../useCases/clipEditing/crossfadeClips', async (importOriginal) => ({
    ...(await importOriginal<typeof crossfadeModule>()),
    crossfadeClips: mocks.crossfadeClips,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));
vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));
vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('handleCrossfadeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.crossfadeClips.mockReturnValue(true);
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, fadeInBeats: 0, fadeOutBeats: 0 }),
                        ClipDummy.create({ id: 'c2', startBeat: 4, endBeat: 8, fadeInBeats: 0, fadeOutBeats: 0 }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);
        mocks.getTrackState.mockReturnValue(trackState);
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }) => ({
            status: 'eligible',
            trackId: 'track-1',
            clipId,
        }));
    });

    it('executes crossfadeClips with the provided payload', () => {
        const result = handleCrossfadeClips.execute({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });

        expect(mocks.crossfadeClips).toHaveBeenCalledWith('c1', 'c2', 0.5);
        expect(result).toEqual({ status: 'written' });
    });

    it('uses the domain default when duration is omitted', () => {
        const result = handleCrossfadeClips.execute({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2' },
        });

        expect(mocks.crossfadeClips).toHaveBeenCalledWith('c1', 'c2', undefined);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the crossfade is rejected', () => {
        mocks.crossfadeClips.mockReturnValue(false);

        const result = handleCrossfadeClips.execute({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });
        expect(desc.label).toBe('Crossfade clips');
    });

    it('describes compensating undo and redo snapshots for both clips', () => {
        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4.5, clipAFadeOutBeats: 0.5, clipBStartBeat: 4, clipBFadeInBeats: 0.5 },
                replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
                replacement: { clipAEndBeat: 4.5, clipAFadeOutBeats: 0.5, clipBStartBeat: 4, clipBFadeInBeats: 0.5 },
            },
        });
    });

    it('is undoable', () => {
        expect(handleCrossfadeClips.undoable).toBe(true);
    });

    it('atomically restores both clip snapshots when compensation expectations still match', () => {
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
                replacement: { clipAEndBeat: 3.5, clipAFadeOutBeats: 0.5, clipBStartBeat: 3.5, clipBFadeInBeats: 0.5 },
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const mapper = mocks.mapAllTracks.mock.calls[0]?.[0];
        const track = mocks.getTrackStoreState()?.tracks[0];
        if (!mapper || !track) {
            throw new Error('Expected mapAllTracks mapper and track fixture');
        }
        expect(mapper(track)).toMatchObject({
            clips: [
                { id: 'c1', endBeat: 3.5, fadeOutBeats: 0.5 },
                { id: 'c2', startBeat: 3.5, fadeInBeats: 0.5 },
            ],
        });
    });

    it('rejects compensation after either clip diverges from the expected snapshot', () => {
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4.5, clipAFadeOutBeats: 1, clipBStartBeat: 3.5, clipBFadeInBeats: 1 },
                replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('describes compensating undo and redo snapshots with clipBAudioOffsetBeats when clip B has audio offset', () => {
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, fadeInBeats: 0, fadeOutBeats: 0 }),
                        ClipDummy.create({
                            id: 'c2',
                            startBeat: 4,
                            endBeat: 8,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            audioOffsetBeats: 2,
                        }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);

        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: 1,
                    clipBStartBeat: 3.5,
                    clipBFadeInBeats: 1,
                    clipBAudioOffsetBeats: 1.5,
                },
                replacement: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 2,
                },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 2,
                },
                replacement: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: 1,
                    clipBStartBeat: 3.5,
                    clipBFadeInBeats: 1,
                    clipBAudioOffsetBeats: 1.5,
                },
            },
        });
    });

    it('describes compensating undo and redo snapshots with clipBMidiOffsetBeats when clip B has midi offset', () => {
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, fadeInBeats: 0, fadeOutBeats: 0 }),
                        ClipDummy.create({
                            id: 'c2',
                            startBeat: 4,
                            endBeat: 8,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            type: 'midi',
                            midiOffsetBeats: 2,
                        }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);

        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: 1,
                    clipBStartBeat: 3.5,
                    clipBFadeInBeats: 1,
                    clipBMidiOffsetBeats: 1.5,
                },
                replacement: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBMidiOffsetBeats: 2,
                },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBMidiOffsetBeats: 2,
                },
                replacement: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: 1,
                    clipBStartBeat: 3.5,
                    clipBFadeInBeats: 1,
                    clipBMidiOffsetBeats: 1.5,
                },
            },
        });
    });

    it('describes compensating undo and redo snapshots with pre-roll handle clamping when clip B pre-roll handle is smaller than halfDuration', () => {
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, fadeInBeats: 0, fadeOutBeats: 0 }),
                        ClipDummy.create({
                            id: 'c2',
                            startBeat: 4,
                            endBeat: 8,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            audioOffsetBeats: 0.1,
                        }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);

        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: expect.closeTo(0.6),
                    clipBStartBeat: 3.9,
                    clipBFadeInBeats: expect.closeTo(0.6),
                    clipBAudioOffsetBeats: 0,
                },
                replacement: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 0.1,
                },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 0.1,
                },
                replacement: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: expect.closeTo(0.6),
                    clipBStartBeat: 3.9,
                    clipBFadeInBeats: expect.closeTo(0.6),
                    clipBAudioOffsetBeats: 0,
                },
            },
        });
    });

    it('describes compensating undo and redo snapshots with handle clamping on a stretched clip B', () => {
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, fadeInBeats: 0, fadeOutBeats: 0 }),
                        ClipDummy.create({
                            id: 'c2',
                            startBeat: 4,
                            endBeat: 8,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            stretchMode: 'timestretch',
                            stretchRatio: 2.0,
                            audioOffsetBeats: 0.2,
                        }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);

        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: expect.closeTo(0.6),
                    clipBStartBeat: 3.9,
                    clipBFadeInBeats: expect.closeTo(0.6),
                    clipBAudioOffsetBeats: 0,
                },
                replacement: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 0.2,
                },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 0.2,
                },
                replacement: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: expect.closeTo(0.6),
                    clipBStartBeat: 3.9,
                    clipBFadeInBeats: expect.closeTo(0.6),
                    clipBAudioOffsetBeats: 0,
                },
            },
        });
    });

    it('restores audioOffsetBeats on clip B when executing compensation', () => {
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4.5, fadeInBeats: 0, fadeOutBeats: 1 }),
                        ClipDummy.create({
                            id: 'c2',
                            startBeat: 3.5,
                            endBeat: 8,
                            fadeInBeats: 1,
                            fadeOutBeats: 0,
                            audioOffsetBeats: 1.5,
                        }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);
        mocks.getTrackState.mockReturnValue(trackState);

        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: {
                    clipAEndBeat: 4.5,
                    clipAFadeOutBeats: 1,
                    clipBStartBeat: 3.5,
                    clipBFadeInBeats: 1,
                    clipBAudioOffsetBeats: 1.5,
                },
                replacement: {
                    clipAEndBeat: 4,
                    clipAFadeOutBeats: 0,
                    clipBStartBeat: 4,
                    clipBFadeInBeats: 0,
                    clipBAudioOffsetBeats: 2,
                },
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const mapper = mocks.mapAllTracks.mock.calls[0]?.[0];
        const track = trackState.tracks[0];
        if (!mapper || !track) {
            throw new Error('Expected mapAllTracks mapper and track fixture');
        }
        expect(mapper(track)).toMatchObject({
            clips: [
                { id: 'c1', endBeat: 4, fadeOutBeats: 0 },
                { id: 'c2', startBeat: 4, fadeInBeats: 0, audioOffsetBeats: 2 },
            ],
        });
    });
});

describe('crossfade recorded leading silence through command history', () => {
    let notifications: NotifyPayload[];
    let unsubscribeFromNotifications: () => void;

    beforeAll(async () => {
        // Retain the unit-test spies above, but connect every domain seam to its
        // production implementation for the real command, CRDT, and undo route.
        const [crossfade, state, storeState, mapper, resolver] = await Promise.all([
            vi.importActual<typeof crossfadeModule>('../../../useCases/clipEditing/crossfadeClips'),
            vi.importActual<typeof trackStateRepo>('../../../repositories/track/getTrackState'),
            vi.importActual<typeof trackStoreStateModule>('../../../useCases/getTrackStoreState'),
            vi.importActual<typeof mapAllTracksRepo>('../../../repositories/track/mapAllTracks'),
            vi.importActual<typeof resolverModule>('../../../stores/resolveEligibleClipWriteTarget'),
        ]);
        mocks.crossfadeClips.mockImplementation(crossfade.crossfadeClips);
        mocks.getTrackState.mockImplementation(state.getTrackState);
        mocks.getTrackStoreState.mockImplementation(storeState.getTrackStoreState);
        mocks.mapAllTracks.mockImplementation(mapper.mapAllTracks);
        mocks.resolveEligibleClipWriteTarget.mockImplementation(resolver.resolveEligibleClipWriteTarget);
    });

    beforeEach(() => {
        Container.clear();
        const notificationBus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        notifications = [];
        unsubscribeFromNotifications = notificationBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationBus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('crossfade recorded leading silence');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        unsubscribeFromNotifications();
        Container.clear();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        { stretchRatio: 1, loopOriginBeat: undefined },
        { stretchRatio: 1, loopOriginBeat: 4 },
        { stretchRatio: 2, loopOriginBeat: undefined },
        { stretchRatio: 2, loopOriginBeat: 4 },
    ])(
        'round-trips signed source origin at stretch $stretchRatio with anchor $loopOriginBeat',
        async ({ stretchRatio, loopOriginBeat }) => {
            const clipOverrides: { loopOriginBeat?: number } = {};
            if (loopOriginBeat !== undefined) {
                clipOverrides.loopOriginBeat = loopOriginBeat;
            }
            const track = TrackDummy.create({
                id: 'track-1',
                clips: [
                    ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4 }),
                    ClipDummy.create({
                        id: 'c2',
                        startBeat: 4,
                        endBeat: 8,
                        audioOffsetBeats: -1,
                        stretchMode: 'timestretch',
                        stretchRatio,
                        loopEnabled: true,
                        loopLength: 4,
                        ...clipOverrides,
                    }),
                ],
            });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            flushAutomergeStorageWrites();
            const before = structuredClone(trackStore.value!.tracks[0]!.clips);
            const origin = 4 + 1 / stretchRatio;
            const transientBeat = origin + 1 / stretchRatio;

            function expectSourceOrigin(): void {
                flushAutomergeStorageWrites();
                const projected = trackStore.value!.tracks[0]!.clips;
                const authoritative = getCrdtDoc<{ tracks: TrackStoreState }>('root')?.tracks.tracks[0]?.clips;
                expect(authoritative).toEqual(projected);
                const clipB = projected[1]!;
                expect.soft(clipB.audioOffsetBeats).toBe(-1);
                expect.soft(clipB.startBeat - clipB.audioOffsetBeats! / stretchRatio).toBe(origin);
                expect.soft(clipB.audioOffsetBeats! + (transientBeat - clipB.startBeat) * stretchRatio).toBe(1);
                expect(clipB.loopOriginBeat).toBe(loopOriginBeat);
                expect(Object.hasOwn(clipB, 'loopOriginBeat')).toBe(loopOriginBeat !== undefined);
            }

            await executeAppAction({
                type: 'crossfadeClips',
                payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
            });
            expectSourceOrigin();
            const after = structuredClone(trackStore.value!.tracks[0]!.clips);
            expect(after[0]).toMatchObject({ endBeat: 4.5, fadeOutBeats: 0.5 });
            expect(after[1]).toMatchObject({ startBeat: 4, endBeat: 8, fadeInBeats: 0.5 });
            expect(undoStore.value?.past).toHaveLength(1);
            const entry = undoStore.value?.past[0];
            if (entry?.kind !== 'action') {
                throw new Error('Expected the crossfade action history entry');
            }
            expect.soft(entry.inverseAction).toMatchObject({
                type: 'restoreCrossfadeClips',
                payload: { expected: { clipBAudioOffsetBeats: -1 }, replacement: { clipBAudioOffsetBeats: -1 } },
            });
            expect.soft(entry.redoAction).toMatchObject({
                type: 'restoreCrossfadeClips',
                payload: { expected: { clipBAudioOffsetBeats: -1 }, replacement: { clipBAudioOffsetBeats: -1 } },
            });

            expect.soft((await undo()).headConsumed).toBe(true);
            expect.soft(notifications).toEqual([]);
            expectSourceOrigin();
            expect(trackStore.value!.tracks[0]!.clips).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);

            await redo();
            expect(notifications).toEqual([]);
            expectSourceOrigin();
            expect(trackStore.value!.tracks[0]!.clips).toEqual(after);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
        }
    );

    describe('canonical clip B source entry', () => {
        afterEach(() => {
            tempoMapStore.set({ changes: [] });
            transportStore.set({ ...defaultTransportState });
        });

        function readerSourceSecondsAt(clip: Clip, beat: number): number {
            const segment = projectAudioLoopPassSegments({
                clip,
                loopLengthBeats: projectClipLoopExpansion({
                    clipDurationBeats: clip.endBeat - clip.startBeat,
                    configuredLoopLengthBeats: clip.loopLength,
                    loopEnabled: clip.loopEnabled ?? false,
                }).loopLengthBeats,
                iterationStartBeat: beat,
                iterationEndBeat: clip.endBeat,
                stretchRatio: clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1,
                tempoAtClipStart: 60,
                secondsAtBeat: (at) => readSecondsAtBeat({ beat: at }),
            })[0];
            if (!segment) {
                throw new Error('the readers project no segment for the clip');
            }
            return segment.sourceStartSeconds;
        }

        it('keeps a looped stretched clip B on its loop phase through crossfade, undo and redo', async () => {
            transportStore.set({ ...defaultTransportState, tempo: 60 });
            const track = TrackDummy.create({
                id: 'track-1',
                clips: [
                    ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4 }),
                    ClipDummy.create({
                        id: 'c2',
                        startBeat: 4,
                        endBeat: 8,
                        stretchMode: 'timestretch',
                        stretchRatio: 2,
                        loopEnabled: true,
                        loopLength: 2,
                        loopOriginBeat: 4,
                        audioLoopPassOriginBeat: 4,
                        audioOffsetBeats: 2,
                        audioOffsetSeconds: 2,
                        audioUnwrappedOffsetSeconds: 2,
                        audioLoopStartSeconds: 2,
                        audioLoopPassEntrySeconds: 2,
                    }),
                ],
            });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            flushAutomergeStorageWrites();
            const before = structuredClone(trackStore.value!.tracks[0]!.clips);
            const beats = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5];
            const reads = (clip: Clip) => beats.map((beat) => readerSourceSecondsAt(clip, beat));
            const readsBefore = reads(before[1]!);
            const expectReadsHeld = (clip: Clip) => {
                for (const [index, read] of reads(clip).entries()) {
                    expect(read, `beat ${beats[index]}`).toBeCloseTo(readsBefore[index]!, 12);
                }
            };

            await executeAppAction({
                type: 'crossfadeClips',
                payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
            });
            const after = structuredClone(trackStore.value!.tracks[0]!.clips);
            expect(after[1]).toMatchObject({ startBeat: 3.5, loopOriginBeat: 4, audioLoopPassOriginBeat: 4 });
            expectReadsHeld(after[1]!);

            expect((await undo()).headConsumed).toBe(true);
            expect(notifications).toEqual([]);
            expect(trackStore.value!.tracks[0]!.clips).toEqual(before);

            await redo();
            expect(notifications).toEqual([]);
            expect(trackStore.value!.tracks[0]!.clips).toEqual(after);
            expectReadsHeld(trackStore.value!.tracks[0]!.clips[1]!);
        });

        it('restores every provenance field of a looped clip B exactly through undo then redo', async () => {
            transportStore.set({ ...defaultTransportState, tempo: 60 });
            const clock = {
                audioOffsetSeconds: 2,
                audioUnwrappedOffsetSeconds: 1.5,
                audioLoopStartSeconds: 0.5,
                audioLoopPassEntrySeconds: 1,
                audioLoopPassOriginBeat: 3,
            };
            const track = TrackDummy.create({
                id: 'track-1',
                clips: [
                    ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4 }),
                    ClipDummy.create({
                        id: 'c2',
                        startBeat: 4,
                        endBeat: 8,
                        loopEnabled: true,
                        loopLength: 2,
                        loopOriginBeat: 3,
                        audioOffsetBeats: 2,
                        ...clock,
                    }),
                ],
            });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            flushAutomergeStorageWrites();
            const before = structuredClone(trackStore.value!.tracks[0]!.clips);

            await executeAppAction({
                type: 'crossfadeClips',
                payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
            });
            const after = structuredClone(trackStore.value!.tracks[0]!.clips);
            // The entry continues half a beat back; the grid fields hold.
            expect(after[1]).toMatchObject({
                startBeat: 3.5,
                loopOriginBeat: 3,
                audioLoopStartSeconds: 0.5,
                audioLoopPassEntrySeconds: 1,
                audioLoopPassOriginBeat: 3,
            });
            expect(after[1]!.audioOffsetSeconds).toBeCloseTo(1.5, 12);
            expect(after[1]!.audioUnwrappedOffsetSeconds).toBeCloseTo(1, 12);

            expect((await undo()).headConsumed).toBe(true);
            expect(notifications).toEqual([]);
            expect(trackStore.value!.tracks[0]!.clips).toEqual(before);

            await redo();
            expect(notifications).toEqual([]);
            expect(trackStore.value!.tracks[0]!.clips).toEqual(after);
        });

        it('keeps clip B material on its beats across a tempo change through crossfade, undo and redo', async () => {
            // 120 BPM to beat 8, then 60. Clip B retreats from 8.25 to 7.75,
            // spanning 0.125 s + 0.25 s of song time.
            transportStore.set({ ...defaultTransportState, tempo: 120 });
            tempoMapStore.set({
                changes: [
                    { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'tempo-b', beat: 8, tempo: 60, curve: 'instant' },
                ],
            });
            const track = TrackDummy.create({
                id: 'track-1',
                clips: [
                    ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 8 }),
                    ClipDummy.create({
                        id: 'c2',
                        startBeat: 8.25,
                        endBeat: 12,
                        audioOffsetBeats: 4,
                        audioOffsetSeconds: 2,
                        audioUnwrappedOffsetSeconds: 2.5,
                    }),
                ],
            });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            flushAutomergeStorageWrites();
            const before = structuredClone(trackStore.value!.tracks[0]!.clips);
            const clipB = () => {
                flushAutomergeStorageWrites();
                const projected = trackStore.value!.tracks[0]!.clips;
                expect(getCrdtDoc<{ tracks: TrackStoreState }>('root')?.tracks.tracks[0]?.clips).toEqual(projected);
                return projected[1]!;
            };
            const downbeatSource = readerSourceSecondsAt(before[1]!, 8.25);
            expect(downbeatSource).toBe(2);

            await executeAppAction({
                type: 'crossfadeClips',
                payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
            });
            const after = structuredClone(trackStore.value!.tracks[0]!.clips);
            expect(clipB()).toMatchObject({ startBeat: 7.75 });
            expect(clipB().audioOffsetSeconds).toBeCloseTo(1.625, 12);
            expect(clipB().audioUnwrappedOffsetSeconds).toBeCloseTo(2.125, 12);
            expect(readerSourceSecondsAt(clipB(), 8.25)).toBeCloseTo(downbeatSource, 12);

            expect((await undo()).headConsumed).toBe(true);
            expect(notifications).toEqual([]);
            expect(clipB()).toEqual(before[1]);
            expect(readerSourceSecondsAt(clipB(), 8.25)).toBe(downbeatSource);

            await redo();
            expect(notifications).toEqual([]);
            expect(clipB()).toEqual(after[1]);
            expect(readerSourceSecondsAt(clipB(), 8.25)).toBeCloseTo(downbeatSource, 12);
        });
    });
});
