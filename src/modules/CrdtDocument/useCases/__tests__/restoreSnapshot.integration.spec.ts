import { change, init, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../../repositories/automergeRepository';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';
import { restoreSnapshot } from '../restoreSnapshot';

describe('restoreSnapshot storage ordering', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('snapshot storage ordering');
        automergeRepository.createChildDoc('changed');
        registerCrdtStorageRuntime();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        automergeRepository.reset();
    });

    it('does not replay a queued store write over restored content', () => {
        let restored = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
        restored = change(restored, (doc) => {
            doc.value = 'restored';
        });
        const storage = createAutomergeStorage<{ value: string }>('changed', 'state');
        storage.set({ value: 'queued before undo' });

        restoreSnapshot(new Map([['changed', { state: 'present', bytes: save(restored) }]]));
        flushAutomergeStorageWrites();

        expect(automergeRepository.getDoc<Record<string, unknown>>('changed')).toMatchObject({ value: 'restored' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('changed')).not.toHaveProperty('state');
    });
});
