import { getChangesMetaSince, getHeads, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { createCrdtDoc } from '../createCrdtDoc';
import { getCrdtDoc } from '../getCrdtDoc';
import { mutateCrdtDoc } from '../mutateCrdtDoc';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';
import { removeCrdtDoc } from '../removeCrdtDoc';

type Root = { state: { count: number } };
function root() {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Expected actual repository root');
    }
    return document;
}

describe('native pre-change storage validation forwarding', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                document.state = { count: 0 };
            },
        });
    });
    afterEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('queries installed history before opening the actual native candidate and publishes matching materializations', () => {
        const basis = getHeads(root());
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.hydrate?.();
        const calls: string[] = [];
        const transaction = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        transaction.validateDocument(
            'root',
            (candidate) => {
                calls.push('prospective');
                expect(candidate.state).toEqual({ count: 1 });
                return null;
            },
            (published) => {
                calls.push('before');
                expect(published).toBe(root());
                expect(getChangesMetaSince(root(), basis)).toEqual([]);
                expect(root().state.count).toBe(0);
                return null;
            }
        );
        transaction.commit();
        expect(calls).toEqual(['before', 'prospective']);
        expect(root().state.count).toBe(1);
        expect(toJS(root()).state.count).toBe(1);
    });

    it('propagates raw refusal before running any candidate callback or changing heads', () => {
        const before = root();
        const heads = getHeads(before);
        const write = vi.fn((document: Root) => {
            document.state.count = 1;
        });
        expect(() =>
            mutateCrdtDoc<Root>({
                id: 'root',
                changeFn: write,
                beforeChange: (published) => {
                    expect(published).toBe(before);
                    throw new Error('Controlled native pre-change refusal');
                },
            })
        ).toThrow('Controlled native pre-change refusal');
        expect(write).not.toHaveBeenCalled();
        expect(root()).toBe(before);
        expect(getHeads(root())).toEqual(heads);
        expect(root().state.count).toBe(0);
        expect(toJS(root()).state.count).toBe(0);
    });

    it('preserves the existing no-hook mutation route', () => {
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                document.state.count = 2;
            },
        });
        expect(root().state.count).toBe(2);
        expect(toJS(root()).state.count).toBe(2);
    });
});
