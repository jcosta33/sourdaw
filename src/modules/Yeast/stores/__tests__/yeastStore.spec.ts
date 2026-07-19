import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { yeastStore } from '../yeastStore';

describe('yeastStore', () => {
    let document: Record<string, unknown>;

    beforeEach(() => {
        document = {};
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(document),
        });
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('stores the serializable processor projection and runtime availability only', () => {
        yeastStore.set({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });

        expect(yeastStore.value).toEqual({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });
        expect(yeastStore.value).not.toHaveProperty('rackInstance');
        expect(yeastStore.value).not.toHaveProperty('_worker');
    });

    it('continues to accept serialized projections without optional parameter state', () => {
        yeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false }],
            uiLevel: 1,
        });

        expect(yeastStore.value?.processors[0]).toEqual({
            id: 'arp-1',
            type: 'arpeggiator',
            name: 'Arpeggiator',
            bypassed: false,
        });
    });

    it('persists processor identity in project CRDT state', () => {
        yeastStore.set({
            processors: [{ id: 'groove-durable-id', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 1,
        });
        flushAutomergeStorageWrites();

        expect(document.yeast).toEqual({
            processors: [{ id: 'groove-durable-id', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 1,
        });
    });
});
