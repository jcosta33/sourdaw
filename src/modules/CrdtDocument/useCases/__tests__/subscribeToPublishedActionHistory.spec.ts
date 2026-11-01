import { clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../../repositories/automergeRepository';
import { actionHistoryStore } from '../../stores/actionHistoryStore';
import { clearActionHistory } from '../clearActionHistory';
import { createCrdtDoc } from '../createCrdtDoc';
import { getCrdtDoc } from '../getCrdtDoc';
import { mutateCrdtDoc } from '../mutateCrdtDoc';
import { recordActionHistoryEntries } from '../recordActionHistoryEntries';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';
import { removeCrdtDoc } from '../removeCrdtDoc';
import { replaceCrdtDoc } from '../replaceCrdtDoc';
import { subscribeToPublishedActionHistory } from '../subscribeToPublishedActionHistory';

const entry = {
    id: 'published-entry',
    label: 'Set snap',
    actionKind: 'setSnapValue',
    source: 'manual' as const,
    timestamp: 10,
    reverted: false,
};

describe('subscribeToPublishedActionHistory', () => {
    const onHistory = vi.fn<Parameters<typeof subscribeToPublishedActionHistory>[0]['onHistory']>();
    const onRootReplaced = vi.fn();
    let unsubscribe: () => void = () => undefined;

    beforeEach(() => {
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearActionHistory();
        flushAutomergeStorageWrites();
        vi.clearAllMocks();
        unsubscribe = subscribeToPublishedActionHistory({ onHistory, onRootReplaced });
        expect(onHistory).toHaveBeenCalledWith([]);
        onHistory.mockClear();
    });

    afterEach(() => {
        unsubscribe();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        removeCrdtDoc('child');
        vi.restoreAllMocks();
    });

    it('ignores optimistic history and its abort while publishing a real two-entry commit', () => {
        const aborted = runWithAutomergeStorageTransaction(undefined, () => recordActionHistoryEntries([entry]));
        expect(actionHistoryStore.value?.entries).toEqual([entry]);
        expect(onHistory).not.toHaveBeenCalled();
        aborted.abort();
        expect(actionHistoryStore.value?.entries).toEqual([]);
        expect(onHistory).not.toHaveBeenCalled();

        const entries = [entry, { ...entry, id: 'second-entry' }];
        const committed = runWithAutomergeStorageTransaction(undefined, () => recordActionHistoryEntries(entries));
        committed.commit();

        expect(onHistory).toHaveBeenCalledExactlyOnceWith(entries);
        expect(onRootReplaced).not.toHaveBeenCalled();
    });

    it('ignores unrelated publications but emits a same-content empty clear', () => {
        mutateCrdtDoc<{ unrelated?: boolean }>({
            id: 'root',
            changeFn: (document) => {
                document.unrelated = true;
            },
        });
        createCrdtDoc('child');
        mutateCrdtDoc<{ unrelated?: boolean }>({
            id: 'child',
            changeFn: (document) => {
                document.unrelated = true;
            },
        });
        expect(onHistory).not.toHaveBeenCalled();
        expect(onRootReplaced).not.toHaveBeenCalled();

        clearActionHistory();

        expect(onHistory).toHaveBeenCalledExactlyOnceWith([]);
        expect(onRootReplaced).not.toHaveBeenCalled();
    });

    it('observes replacement of an equal entries list inside the same history map', () => {
        mutateCrdtDoc<{ actionHistory: { entries: unknown[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.actionHistory.entries = [];
            },
        });

        expect(onHistory).toHaveBeenCalledExactlyOnceWith([]);
        expect(onRootReplaced).not.toHaveBeenCalled();
    });

    it('resets only on actual root installation and observes same-content replacement once', () => {
        const document = getCrdtDoc('root');
        if (!document) {
            throw new Error('Expected active root');
        }
        createCrdtDoc('root', clone(document));
        expect(onRootReplaced).toHaveBeenCalledTimes(1);
        expect(onHistory).toHaveBeenCalledExactlyOnceWith([]);

        replaceCrdtDoc({ id: 'root', doc: clone(document) });

        expect(onRootReplaced).toHaveBeenCalledTimes(2);
        expect(onHistory).toHaveBeenCalledTimes(2);
    });

    it('does not publish metadata when the real storage boundary refuses the write', () => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () => recordActionHistoryEntries([entry]));
        const failure = new Error('metadata publication refused');
        vi.spyOn(automergeRepository, 'changeDoc').mockImplementationOnce(() => {
            throw failure;
        });
        try {
            expect(() => transaction.commit()).toThrow(failure);
        } finally {
            transaction.abort();
        }

        expect(actionHistoryStore.value?.entries).toEqual([]);
        expect(onHistory).not.toHaveBeenCalled();
        expect(onRootReplaced).not.toHaveBeenCalled();
    });

    it('unsubscribes from both publication and root installation', () => {
        unsubscribe();
        clearActionHistory();
        flushAutomergeStorageWrites();
        createCrdtDoc('root');

        expect(onHistory).not.toHaveBeenCalled();
        expect(onRootReplaced).not.toHaveBeenCalled();
    });

    it('removes its observers when initial delivery throws', () => {
        unsubscribe();
        const failure = new Error('observer refused initial history');
        const throws = vi.fn(() => {
            throw failure;
        });
        expect(() => subscribeToPublishedActionHistory({ onHistory: throws, onRootReplaced })).toThrow(failure);

        clearActionHistory();
        flushAutomergeStorageWrites();
        createCrdtDoc('root');

        expect(throws).toHaveBeenCalledTimes(1);
        expect(onRootReplaced).not.toHaveBeenCalled();
    });
});
