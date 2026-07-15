import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { actionHistoryStore } from '../../../stores/actionHistoryStore';
import { createCrdtDoc } from '../../createCrdtDoc';
import { recordActionHistoryEntry } from '../../recordActionHistoryEntry';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { removeCrdtDoc } from '../../removeCrdtDoc';
import { projectActionHistoryToStore } from '../projectActionHistoryToStore';

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('projectActionHistoryToStore', () => {
    beforeEach(() => {
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
    });

    afterEach(async () => {
        await flush_pending_frame();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('should clear source metadata from the observable store when the replacement document is empty', async () => {
        recordActionHistoryEntry({
            id: 'project-a-entry',
            label: 'Project A action',
            actionKind: 'setTempo',
            source: 'manual',
            timestamp: 1,
            reverted: false,
        });
        await flush_pending_frame();
        expect(actionHistoryStore.value?.entries.map((entry) => entry.id)).toEqual(['project-a-entry']);

        removeCrdtDoc('root');
        createCrdtDoc('root');
        projectActionHistoryToStore();

        expect(actionHistoryStore.value).toEqual({ entries: [] });
    });
});
