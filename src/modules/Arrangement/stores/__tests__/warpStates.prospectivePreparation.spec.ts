import { applyChanges, getActorId, getChanges, getHeads, clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

beforeEach(() => {
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

describe('Arrangement private warp-state preparation', () => {
    it('keeps raw/projection/revision invisible, then publishes one actual-actor change to an independent peer', () => {
        const before = getCrdtDoc('root');
        if (!before) {
            throw new Error('Expected root');
        }
        const peer = clone(before, { actor: 'bbbbbbbbbbbbbbbb' });
        const beforeHeads = getHeads(before);
        const revision = captureProjectRevision();
        const beforeProjection = warpStateStore.value;
        const { transaction, preparation } = plan();
        preparation.clone();
        preparation.materialize();
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

    it('refuses a stale stage and lets a fresh plan retain later user and sibling rows', () => {
        const first = plan();
        first.preparation.clone();
        first.preparation.materialize();
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
        prepared.clone();
        prepared.materialize();
        expect(transaction.scope(prepared.stage)).toBe(true);
        transaction.validateDocument('root', () => null);
        transaction.commit();
        expect(getWarpState('target').markers).toContainEqual(latest.markers[1]);
        expect(getWarpState('other').originalTempo).toBe(99);
    });
});
