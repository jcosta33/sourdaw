import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clipSelectionStore, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    addClip,
    createTrack,
    selectClipWithFocus,
    setClipSelection,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { createAppActionCommittedError, executeAppActionBatch, executeUserAppAction } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { enqueueClipDuplicate } from '../enqueueClipDuplicate';

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return { ...actual, executeUserAppAction: vi.fn(), executeAppActionBatch: vi.fn() };
});
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const dispatchSingle = vi.mocked(executeUserAppAction);
const dispatchBatch = vi.mocked(executeAppActionBatch);

function clips() {
    return trackStore.value?.tracks[0]?.clips ?? [];
}

// Controlled Command outcomes exercise the coordinator's interpretation only.
// Real transaction admission, CRDT writes and history are covered by handleKeydownDuplicateSelection.integration.
function createNamedCopies(actions: readonly AppAction[]): void {
    for (const action of actions) {
        if (
            action.type !== 'duplicateClip' &&
            action.type !== 'duplicateClipToNextBar' &&
            action.type !== 'duplicateClipAt'
        ) {
            throw new Error('Expected a duplicate action at the controlled Command boundary');
        }
        const source = clips().find((clip) => clip.id === action.payload.clipId);
        if (!source || !action.payload.targetClipId) {
            throw new Error('Expected source and preallocated copy ID');
        }
        const startBeat = action.type === 'duplicateClipAt' ? action.payload.startBeat : source.endBeat;
        addClip({
            id: action.payload.targetClipId,
            trackId: 'track',
            name: 'Controlled copy',
            type: 'midi',
            startBeat,
            endBeat: startBeat + source.endBeat - source.startBeat,
        });
    }
    flushAutomergeStorageWrites();
}

function installSuccessfulSingle(): void {
    dispatchSingle.mockImplementation(async (action) => {
        createNamedCopies([action]);
    });
}

function installSuccessfulBatch(): void {
    dispatchBatch.mockImplementation(async (actions) => {
        createNamedCopies(actions);
        return { status: 'committed', actions: [] };
    });
}

describe('ordered duplicate intent controlled outcomes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate coordinator outcome interpretation');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track', kind: 'midi', name: 'Keys' })],
        });
        addClip({ id: 'source', trackId: 'track', name: 'Source', type: 'midi', startBeat: 1, endBeat: 3 });
        addClip({ id: 'other', trackId: 'track', name: 'Other', type: 'midi', startBeat: 4, endBeat: 9 });
        selectClipWithFocus('source');
        flushAutomergeStorageWrites();
        installSuccessfulSingle();
        installSuccessfulBatch();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['duplicateClip', 'duplicateClipToNextBar'] as const)(
        'starts idle %s immediately and resolves the second source on its turn',
        async (type) => {
            const held = Promise.withResolvers<void>();
            dispatchSingle.mockImplementationOnce(async (action) => {
                await held.promise;
                createNamedCopies([action]);
            });
            const first = enqueueClipDuplicate(type);
            expect(dispatchSingle).toHaveBeenCalledTimes(1);
            const second = enqueueClipDuplicate(type);
            expect(dispatchSingle).toHaveBeenCalledTimes(1);
            held.resolve();
            await Promise.all([first, second]);
            const firstAction = dispatchSingle.mock.calls[0]?.[0];
            const secondAction = dispatchSingle.mock.calls[1]?.[0];
            expect(firstAction).toMatchObject({ type, payload: { clipId: 'source' } });
            if (firstAction?.type !== 'duplicateClip' && firstAction?.type !== 'duplicateClipToNextBar') {
                throw new Error('Expected first single-clip duplicate action');
            }
            expect(secondAction).toMatchObject({ type, payload: { clipId: firstAction.payload.targetClipId } });
            expect(clipSelectionStore.value?.selectedClipId).toBe(clips()[3]?.id);
            expect(logger.error).not.toHaveBeenCalled();
        }
    );

    it('ignores next-bar input between queued multi-clip duplicates without retiring their chain', async () => {
        setClipSelection(['source', 'other']);
        const held = Promise.withResolvers<void>();
        dispatchBatch.mockImplementationOnce(async (actions) => {
            await held.promise;
            createNamedCopies(actions);
            return { status: 'committed', actions: [] };
        });
        const first = enqueueClipDuplicate('duplicateClip');
        const ignored = enqueueClipDuplicate('duplicateClipToNextBar');
        const second = enqueueClipDuplicate('duplicateClip');
        expect(dispatchBatch).toHaveBeenCalledTimes(1);
        held.resolve();
        await Promise.all([first, ignored, second]);
        expect(dispatchSingle).not.toHaveBeenCalled();
        expect(dispatchBatch).toHaveBeenCalledTimes(2);
        expect(clips().map(({ startBeat, endBeat }) => [startBeat, endBeat])).toEqual([
            [1, 3],
            [4, 9],
            [9, 11],
            [12, 17],
            [17, 19],
            [20, 25],
        ]);
        expect(dispatchBatch.mock.calls[1]?.[0]).toMatchObject([
            { type: 'duplicateClipAt', payload: { clipId: clips()[2]?.id, startBeat: 17 } },
            { type: 'duplicateClipAt', payload: { clipId: clips()[3]?.id, startBeat: 20 } },
        ]);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(
            clips()
                .slice(4)
                .map((clip) => clip.id)
        );
        expect(logger.error).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it.each(['refused', 'thrown'] as const)(
        'retires a %s single chain and lets fresh input recover',
        async (outcome) => {
            const held = Promise.withResolvers<void>();
            dispatchSingle.mockImplementationOnce(async () => {
                await held.promise;
                if (outcome === 'thrown') {
                    throw new Error('noncommitted failure');
                }
            });
            const first = enqueueClipDuplicate('duplicateClip');
            const second = enqueueClipDuplicate('duplicateClip');
            held.resolve();
            await Promise.all([first, second]);
            expect(dispatchSingle).toHaveBeenCalledTimes(1);
            expect(clipSelectionStore.value?.selectedClipId).toBe('source');
            expect(clips()).toHaveLength(2);
            if (outcome === 'thrown') {
                expect(logger.error).toHaveBeenCalledWith(
                    expect.objectContaining({
                        message: 'Keyboard shortcut duplicate failed',
                        cause: expect.objectContaining({ message: 'noncommitted failure' }),
                    })
                );
            }
            await enqueueClipDuplicate('duplicateClip');
            expect(dispatchSingle).toHaveBeenCalledTimes(2);
            expect(clips()).toHaveLength(3);
        }
    );

    it('selects a single committed-error witness, reports the error and chains without replaying that mutation', async () => {
        const committedError = createAppActionCommittedError({
            actionType: 'duplicateClip',
            cause: new Error('post-commit failure'),
        });
        dispatchSingle.mockImplementationOnce(async (action) => {
            createNamedCopies([action]);
            throw committedError;
        });
        await Promise.all([enqueueClipDuplicate('duplicateClip'), enqueueClipDuplicate('duplicateClip')]);
        expect(dispatchSingle).toHaveBeenCalledTimes(2);
        expect(clips().map((clip) => clip.startBeat)).toEqual([1, 4, 3, 5]);
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(committedError);
        expect(clipSelectionStore.value?.selectedClipId).toBe(clips()[3]?.id);
    });

    it('retires a committed-error result with no live copy instead of retrying it', async () => {
        dispatchSingle.mockRejectedValueOnce(
            createAppActionCommittedError({ actionType: 'duplicateClip', cause: new Error('missing witness') })
        );
        await Promise.all([enqueueClipDuplicate('duplicateClip'), enqueueClipDuplicate('duplicateClip')]);
        expect(dispatchSingle).toHaveBeenCalledTimes(1);
        expect(clips()).toHaveLength(2);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it.each(['rejected', 'conflicted', 'no-op', 'failed'] as const)(
        'retires a %s batch and lets fresh input recover',
        async (status) => {
            setClipSelection(['source', 'other']);
            if (status === 'no-op') {
                dispatchBatch.mockResolvedValueOnce({ status, actions: [] });
            } else {
                dispatchBatch.mockResolvedValueOnce({ status, reason: 'controlled boundary result', actions: [] });
            }
            await Promise.all([enqueueClipDuplicate('duplicateClip'), enqueueClipDuplicate('duplicateClip')]);
            expect(dispatchBatch).toHaveBeenCalledTimes(1);
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['source', 'other']);
            if (status === 'rejected' || status === 'conflicted') {
                expect(notifyUser).toHaveBeenCalledWith(
                    'Duplicate clips forward was refused: controlled boundary result',
                    'warning'
                );
            }
            if (status === 'failed') {
                expect(logger.error).toHaveBeenCalledTimes(1);
            }
            await enqueueClipDuplicate('duplicateClip');
            expect(dispatchBatch).toHaveBeenCalledTimes(2);
            expect(clips()).toHaveLength(4);
        }
    );

    it.each(['all', 'partial', 'none'] as const)(
        'uses only the live %s copies from an ambiguous batch without replay',
        async (witness) => {
            setClipSelection(['source', 'other']);
            dispatchBatch.mockImplementationOnce(async (actions) => {
                if (witness === 'all') {
                    createNamedCopies(actions);
                } else if (witness === 'partial') {
                    createNamedCopies(actions.slice(0, 1));
                } else {
                    createNamedCopies([]);
                }
                return { status: 'ambiguous', reason: 'commit acknowledgement lost', actions: [] };
            });
            await Promise.all([enqueueClipDuplicate('duplicateClip'), enqueueClipDuplicate('duplicateClip')]);
            expect(logger.error).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    message: 'Duplicate clips forward has an uncertain committed outcome: commit acknowledgement lost',
                })
            );
            expect(dispatchBatch).toHaveBeenCalledTimes(witness === 'all' ? 2 : 1);
            if (witness === 'all') {
                expect(clips().map((clip) => clip.startBeat)).toEqual([1, 4, 9, 12, 17, 20]);
                expect(clipSelectionStore.value?.selectedClipIds).toEqual(
                    clips()
                        .slice(4)
                        .map((clip) => clip.id)
                );
            } else if (witness === 'partial') {
                expect(clipSelectionStore.value?.selectedClipIds).toEqual([clips()[2]?.id]);
            } else {
                expect(clipSelectionStore.value?.selectedClipIds).toEqual(['source', 'other']);
            }
        }
    );

    it.each([false, true])(
        'preserves a newer selection after a commit but before dispatch completion (multi: %s)',
        async (multi) => {
            const held = Promise.withResolvers<void>();
            if (multi) {
                setClipSelection(['source', 'other']);
                dispatchBatch.mockImplementationOnce(async (actions) => {
                    createNamedCopies(actions);
                    await held.promise;
                    return { status: 'committed', actions: [] };
                });
            } else {
                dispatchSingle.mockImplementationOnce(async (action) => {
                    createNamedCopies([action]);
                    await held.promise;
                });
            }
            const first = enqueueClipDuplicate('duplicateClip');
            const second = enqueueClipDuplicate('duplicateClip');
            selectClipWithFocus('other');
            const newer = clipSelectionStore.value;
            held.resolve();
            await Promise.all([first, second]);
            expect(clipSelectionStore.value).toBe(newer);
            expect(dispatchSingle).toHaveBeenCalledTimes(multi ? 0 : 1);
            expect(dispatchBatch).toHaveBeenCalledTimes(multi ? 1 : 0);
            await enqueueClipDuplicate('duplicateClip');
            expect(clips().at(-1)).toMatchObject({ startBeat: 9, endBeat: 14 });
            expect(clipSelectionStore.value?.selectedClipId).toBe(clips().at(-1)?.id);
        }
    );

    it('reports a committed error while preserving a newer selection', async () => {
        const committedError = createAppActionCommittedError({
            actionType: 'duplicateClip',
            cause: new Error('post-commit failure'),
        });
        dispatchSingle.mockImplementationOnce(async (action) => {
            createNamedCopies([action]);
            selectClipWithFocus('other');
            throw committedError;
        });
        await Promise.all([enqueueClipDuplicate('duplicateClip'), enqueueClipDuplicate('duplicateClip')]);
        expect(logger.error).toHaveBeenCalledExactlyOnceWith(committedError);
        expect(clipSelectionStore.value?.selectedClipId).toBe(clips().at(-1)?.id);
        expect(clips().at(-1)).toMatchObject({ startBeat: 9, endBeat: 14 });
        expect(dispatchSingle).toHaveBeenCalledTimes(2);
    });

    it('does not dispatch without a selected clip or next-bar duplicate a multi selection', async () => {
        setClipSelection([]);
        await enqueueClipDuplicate('duplicateClip');
        setClipSelection(['source', 'other']);
        await enqueueClipDuplicate('duplicateClipToNextBar');
        expect(dispatchSingle).not.toHaveBeenCalled();
        expect(dispatchBatch).not.toHaveBeenCalled();
    });
});
