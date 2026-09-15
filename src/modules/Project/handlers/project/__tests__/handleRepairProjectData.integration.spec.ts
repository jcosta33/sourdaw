import { change, clone, load, merge, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    createCrdtDoc,
    findAutomergeProjectConflicts,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { handleRepairProjectData } from '../handleRepairProjectData';

/**
 * The end-to-end repair route of issue #3573 against a real Automerge
 * document: a concurrent edit merged into the project leaves a genuine
 * conflict, the gate refuses every action but the repair, and the repair
 * closes the conflict by keeping the value the document already resolved to.
 */
type ProjectDocument = {
    targets: Record<string, { gain: number; id: string; name: string }>;
};

function seedProjectDocument(): void {
    createCrdtDoc('root');
    mutateCrdtDoc<ProjectDocument>({
        id: 'root',
        changeFn: (doc) => {
            doc.targets = { 'track-bass': { gain: 0.8, id: 'track-bass', name: 'Bass' } };
        },
    });
}

function mergeConflictingRemoteEdit(): void {
    const local = getCrdtDoc('root') as ProjectDocument | null;
    if (!local) {
        throw new Error('Expected a seeded root document');
    }
    const remote = change(clone(local, { actor: 'b'.repeat(64) }), (draft) => {
        draft.targets['track-bass']!.gain = 0.7;
    });
    mutateCrdtDoc<ProjectDocument>({
        id: 'root',
        changeFn: (doc) => {
            doc.targets['track-bass']!.gain = 0.6;
        },
    });
    const localHead = load<ProjectDocument>(save(getCrdtDoc('root') as ProjectDocument));
    const merged = merge(localHead, remote);
    // The lineage-preserving replacement a sync merge performs — the identity-
    // moving `replaceCrdtDoc` is for project replacement, not merged edits.
    replaceCrdtDocInLineage({ id: 'root', doc: merged });
    if (findAutomergeProjectConflicts({ document: getCrdtDoc('root') as ProjectDocument }).length === 0) {
        throw new Error('Expected the merged document to carry a conflict');
    }
}

function registerCanaryHandler(): void {
    registerHandlerMap({
        repairProjectData: handleRepairProjectData,
        setTrackPan: {
            describe: (action: Extract<AppAction, { type: 'setTrackPan' }>) => ({
                label: `Set ${action.payload.trackId} pan`,
            }),
            execute: () => ({ status: 'written' }),
            undoable: true,
        },
    });
}

describe('handleRepairProjectData against a conflicted document', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        registerCrdtStorageRuntime();
        agentProjectInspectionPort.setProvider(() => ({
            audioGraphValid: true,
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        clearHandlerRegistry();
        clearUndoHistory();
        agentProjectRepairStateStore.set(null);
        registerCanaryHandler();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        agentProjectInspectionPort.setProvider(null);
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
        clearUndoHistory();
        vi.unstubAllGlobals();
    });

    it('keeps the resolved conflict value, clears the gate, and re-admits mutations', async () => {
        seedProjectDocument();

        // Undo history exists before anything goes wrong; the repair must not
        // disturb it (the repair changes no musical content).
        await executeAppAction({
            type: 'setTrackPan',
            payload: { expectedPan: 0, pan: 0.1, trackId: 'track-bass' },
        });
        expect(undoStore.value?.past.length).toBe(1);

        mergeConflictingRemoteEdit();
        projectCrdtToStores();

        // The merged conflict holds the gate: every action is refused...
        expect(agentProjectRepairStateStore.value).toMatchObject({
            repairCandidates: [{ kind: 'choose-automerge-conflict-value', path: ['targets', 'track-bass', 'gain'] }],
            status: 'repair-required',
        });
        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { expectedPan: 0.1, pan: 0.2, trackId: 'track-bass' } })
        ).rejects.toThrow('Action conflicts with current project state: setTrackPan');

        // ...except the repair itself, which is the admitted route through it.
        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(agentProjectRepairStateStore.value).toBeNull();
        const repaired = getCrdtDoc('root') as ProjectDocument | null;
        if (!repaired) {
            throw new Error('Expected the repaired root document');
        }
        expect(findAutomergeProjectConflicts({ document: repaired })).toEqual([]);
        // The document had already resolved the conflict to the concurrent
        // value (0.7): the repair closes the conflict by keeping that resolved
        // value, not by re-imposing either side's preference.
        expect(repaired.targets['track-bass']?.gain).toBe(0.7);

        // Mutations are re-admitted and undo history survived the repair.
        expect(undoStore.value?.past.length).toBe(1);
        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { expectedPan: 0.1, pan: 0.2, trackId: 'track-bass' } })
        ).resolves.toBeUndefined();
        expect(undoStore.value?.past.length).toBe(2);
    });
});
