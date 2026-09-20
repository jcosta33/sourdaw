import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { getProjectHandlers } from '../getProjectHandlers';
import { setTrackCanonicalRole } from '../setTrackCanonicalRole';

function savedBrief() {
    return getCrdtDoc<{ projectMeta: { productionBrief: NonNullable<typeof projectStore.value>['productionBrief'] } }>(
        'root'
    )?.projectMeta?.productionBrief;
}

describe('set track canonical role', () => {
    let database: ReturnType<typeof installTransactionalIndexedDb>;
    beforeEach(async () => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        database = installTransactionalIndexedDb();
        await createCrdtProject('Role override');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getProjectHandlers());
        registerHandlerMap(getArrangementHandlers());
        setArrangementEventBus(createEventBus());
        setTrackStoreState({
            ...structuredClone(defaultTrackState),
            tracks: [createTrack({ id: 't', name: 'Kick', kind: 'midi' })],
        });
        const brief = createDefaultProductionBrief(100);
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: {
                ...brief,
                vision: 'Keep the feel',
                trackRoles: [
                    { id: 'legacy', trackId: 'other', role: 'freeform identity', createdAt: 100 },
                    { id: 't-1', trackId: 't', role: 'legacy lead', createdAt: 100 },
                    { id: 't-2', trackId: 't', role: 'kick', createdAt: 100 },
                ],
                locks: [
                    {
                        id: 'lock',
                        scope: { kind: 'track', trackId: 'other' },
                        statement: 'Keep other track',
                        createdAt: 100,
                    },
                ],
                decisions: [
                    {
                        id: 'decision',
                        scope: { kind: 'project' },
                        statement: 'Preserve swing',
                        rationale: null,
                        status: 'locked',
                        sourceRunId: null,
                        relatedBatchId: null,
                        supersededByDecisionId: null,
                        createdAt: 100,
                    },
                ],
            },
        });
        await vi.waitFor(() => expect(savedBrief()).toEqual(projectStore.value!.productionBrief));
        clearUndoHistory();
    });
    afterEach(async () => {
        configureAutomergeStoragePort(null);
        await database.dispose();
        vi.unstubAllGlobals();
    });

    it('uses the real Command and CRDT write, then authenticated undo and redo while preserving the rest of the brief', async () => {
        const original = structuredClone(projectStore.value!.productionBrief);
        await setTrackCanonicalRole({ trackId: 't', role: 'snare', expectedRevision: original.revision });
        const changed = projectStore.value!.productionBrief;
        expect(changed.trackRoles).toEqual([
            original.trackRoles[0],
            expect.objectContaining({ trackId: 't', role: 'snare' }),
        ]);
        expect(savedBrief()).toEqual(changed);
        expect(changed).toMatchObject({
            vision: original.vision,
            locks: original.locks,
            decisions: original.decisions,
            revision: 1,
        });
        await undo();
        expect(projectStore.value!.productionBrief.trackRoles).toEqual(original.trackRoles);
        expect(savedBrief()).toEqual(projectStore.value!.productionBrief);
        await redo();
        expect(projectStore.value!.productionBrief.trackRoles).toEqual(changed.trackRoles);
        expect(savedBrief()).toEqual(projectStore.value!.productionBrief);
    });
    it('automatic mode removes only this track override and remains undoable', async () => {
        const original = structuredClone(projectStore.value!.productionBrief);
        await setTrackCanonicalRole({ trackId: 't', role: null, expectedRevision: original.revision });
        expect(projectStore.value!.productionBrief.trackRoles).toEqual([original.trackRoles[0]]);
        expect(savedBrief()).toEqual(projectStore.value!.productionBrief);
        await undo();
        expect(projectStore.value!.productionBrief.trackRoles).toEqual(original.trackRoles);
    });
    it('rejects a stale inspector edit after a competing real brief Command without overwriting it', async () => {
        const original = projectStore.value!.productionBrief;
        const competing = { ...structuredClone(original), revision: original.revision + 1, vision: 'New vision' };
        await executeAppAction({
            type: 'setProductionBrief',
            payload: { expectedRevision: original.revision, brief: competing },
        });
        await expect(
            setTrackCanonicalRole({ trackId: 't', role: 'bass', expectedRevision: original.revision })
        ).rejects.toThrow();
        expect(projectStore.value!.productionBrief).toEqual(competing);
        expect(savedBrief()).toEqual(competing);
    });
    it('refuses a queued override when the track was removed while a snapshot transaction held it', async () => {
        const entered = Promise.withResolvers<object>();
        const release = Promise.withResolvers<void>();
        const transaction = transactSnapshot(async (token) => {
            entered.resolve(token);
            await release.promise;
        });
        const token = await entered.promise;
        const original = structuredClone(projectStore.value!.productionBrief);
        const pending = setTrackCanonicalRole({ trackId: 't', role: 'snare', expectedRevision: original.revision });
        const outcome = pending.then(
            () => null,
            (error: unknown) => error
        );
        let undoCount = 0;
        try {
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 't' } }, { snapshotTransaction: token });
            undoCount = undoStore.value!.past.length;
        } finally {
            release.resolve();
        }
        await transaction;
        expect(await outcome).toBeInstanceOf(Error);
        expect(undoStore.value!.past).toHaveLength(undoCount);
        expect(projectStore.value!.productionBrief).toEqual(original);
        expect(savedBrief()).toEqual(original);
    });

    it('refuses a queued override after project replacement even when ids and brief revisions match', async () => {
        const original = structuredClone(projectStore.value!.productionBrief);
        const pending = setTrackCanonicalRole({ trackId: 't', role: 'snare', expectedRevision: original.revision });
        const outcome = pending.then(
            () => null,
            (error: unknown) => error
        );
        resetCrdtProjectAuthority('Canonical role project replacement');
        const replacement = { ...structuredClone(original), vision: 'Replacement project' };
        projectStore.set({ ...projectStore.value!, productionBrief: replacement });
        const undoCount = undoStore.value!.past.length;
        expect(await outcome).toBeInstanceOf(Error);
        expect(undoStore.value!.past).toHaveLength(undoCount);
        expect(projectStore.value!.productionBrief).toEqual(replacement);
    });

    it('refuses unknown tracks and unsupported role strings without writing', async () => {
        const original = structuredClone(projectStore.value!.productionBrief);
        await expect(setTrackCanonicalRole({ trackId: 'absent', role: 'kick', expectedRevision: 0 })).rejects.toThrow();
        await expect(setTrackCanonicalRole({ trackId: 't', role: 'invented', expectedRevision: 0 })).rejects.toThrow();
        expect(projectStore.value!.productionBrief).toEqual(original);
    });
});
