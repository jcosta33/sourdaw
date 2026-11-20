import {
    applyChanges,
    change,
    clone,
    decodeChange,
    encodeChange,
    free,
    getActorId,
    getChanges,
    getHeads,
    load,
} from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyCanonicalStorageSlotMutation,
    type CanonicalStorageSlotMutation,
} from '#/infra/store/storage/applyCanonicalStorageSlotMutation';
import {
    captureAutomergeStoragePreparationScope,
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { getWarpState, prepareTransientWarpState, setWarpState, warpStateStore } from '../warpStates';

type WarpState = Parameters<typeof setWarpState>[1];
const original: WarpState = {
    enabled: true,
    stretchMode: 'repitch',
    originalTempo: 120,
    markers: [
        { id: 'locked', originalBeat: 1, warpedBeat: 2, origin: 'transient-auto', locked: true, confidence: 0.9 },
    ],
};
const replacement: WarpState = {
    ...original,
    markers: [
        ...original.markers,
        { id: 'new', originalBeat: 3, warpedBeat: 3, origin: 'transient-auto', confidence: 0.7 },
    ],
};

type PreparationRequest = {
    seed: Uint8Array;
    actor: string;
    message?: string;
    mutation: CanonicalStorageSlotMutation;
    preparationPolicy?: string;
};

const requests: Array<{ key: string; policy?: string }> = [];

class WarpPreparationWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

    postMessage({ seed, actor, message, mutation, preparationPolicy }: PreparationRequest): void {
        requests.push({ key: mutation.key, policy: preparationPolicy });
        const before = load<Record<string, unknown>>(seed, { actor });
        const after = change(before, { message }, (draft) => applyCanonicalStorageSlotMutation(draft, mutation));
        try {
            // This fixture's small edit fits one native sequence member.
            const changes = getChanges(before, after).map((bytes) => {
                const { hash: _hash, ...decoded } = decodeChange(bytes);
                return Uint8Array.from(encodeChange(decoded));
            });
            const data: {
                status: 'complete';
                changes: Uint8Array[];
                heads: string[];
                sequence?: { changeCount: number; operationCount: number };
            } = { status: 'complete', changes, heads: getHeads(after) };
            if (preparationPolicy === 'bounded-native-sequence-v1') {
                const operationCount = changes.reduce((total, bytes) => total + decodeChange(bytes).ops.length, 0);
                data.sequence = { changeCount: changes.length, operationCount };
            }
            this.onmessage?.(new MessageEvent('message', { data }));
        } finally {
            free(after);
        }
    }

    terminate(): void {}
}

beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal('Worker', WarpPreparationWorker);
    configureAutomergeStoragePort(null);
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    warpStateStore.set({ states: {} });
    setWarpState('target', original);
    setWarpState('other', { ...original, originalTempo: 91 });
    flushAutomergeStorageWrites();
});
afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    vi.unstubAllGlobals();
});

function plan() {
    const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    const preparation = prepareTransientWarpState(transaction.value, 'target', replacement);
    if (!preparation) {
        throw new Error('Expected prepared owner write');
    }
    return { transaction, preparation };
}

async function materialize(preparation: ReturnType<typeof plan>['preparation']): Promise<void> {
    preparation.clone();
    const request = preparation.requestMaterialization;
    if (!request) {
        throw new Error('Expected an owner-scoped Worker request');
    }
    await request(new AbortController().signal);
    preparation.materialize();
}

describe('Arrangement private warp-state preparation', () => {
    it('keeps bounded native preparation private, then publishes one actual-actor change to an independent peer', async () => {
        const before = getCrdtDoc('root');
        if (!before) {
            throw new Error('Expected root');
        }
        const peer = clone(before, { actor: 'bbbbbbbbbbbbbbbb' });
        const beforeHeads = getHeads(before);
        const revision = captureProjectRevision();
        const beforeProjection = warpStateStore.value;
        const { transaction, preparation } = plan();
        expect(requests).toEqual([]);
        await materialize(preparation);
        expect(requests).toEqual([{ key: 'warpStates', policy: 'bounded-native-sequence-v1' }]);
        expect(getCrdtDoc('root')).toBe(before);
        expect(getHeads(before)).toEqual(beforeHeads);
        expect(warpStateStore.value).toBe(beforeProjection);
        expect(captureProjectRevision()).toBe(revision);
        expect(transaction.scope(preparation.stage)).toBe(true);
        transaction.validateDocument('root', () => null);
        transaction.commit();
        const after = getCrdtDoc('root');
        if (!after) {
            throw new Error('Expected committed root');
        }
        expect(getActorId(after)).toBe(getActorId(before));
        const changes = getChanges(before, after);
        expect(changes).toHaveLength(1);
        const [merged] = applyChanges(peer, changes);
        expect(merged).toEqual(after);
        expect(getWarpState('target')).toEqual(replacement);
        expect(getWarpState('other').originalTempo).toBe(91);
        expect(warpStateStore.value).toEqual(after.warpStates);
    });

    it('refuses a stale stage and lets a fresh plan retain later user and sibling rows', async () => {
        const first = plan();
        await materialize(first.preparation);
        setWarpState('other', { ...getWarpState('other'), originalTempo: 99 });
        setWarpState('target', {
            ...original,
            markers: [...original.markers, { id: 'later-user', originalBeat: 5, warpedBeat: 6, origin: 'user' }],
        });
        flushAutomergeStorageWrites();
        expect(first.preparation.isCurrent()).toBe(false);
        expect(first.transaction.scope(first.preparation.stage)).toBe(false);
        first.preparation.discard();
        first.transaction.abort();
        const latest = getWarpState('target');
        const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const prepared = prepareTransientWarpState(transaction.value, 'target', {
            ...latest,
            markers: [...latest.markers, replacement.markers[1]!],
        });
        if (!prepared) {
            throw new Error('Expected fresh plan');
        }
        await materialize(prepared);
        expect(transaction.scope(prepared.stage)).toBe(true);
        transaction.validateDocument('root', () => null);
        transaction.commit();
        expect(getWarpState('target').markers).toContainEqual(latest.markers[1]);
        expect(getWarpState('other').originalTempo).toBe(99);
    });
});
