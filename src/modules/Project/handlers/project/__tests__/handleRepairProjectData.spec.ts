import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { type AgentProjectRepairState } from '#/modules/CrdtDocument/stores';

import { handleRepairProjectData } from '../handleRepairProjectData';

const mocks = vi.hoisted(() => ({
    agentProjectRepairStateStore: {
        value: null as AgentProjectRepairState | null,
    },
    mutateCrdtDoc: vi.fn(),
    projectCrdtToStores: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/stores')>()),
    agentProjectRepairStateStore: mocks.agentProjectRepairStateStore,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    mutateCrdtDoc: mocks.mutateCrdtDoc,
    projectCrdtToStores: mocks.projectCrdtToStores,
}));

function setRepairState(candidates: AgentProjectRepairState['repairCandidates']): void {
    mocks.agentProjectRepairStateStore.value = {
        audioGraphValid: false,
        detectedRevision: 'rev-test',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: candidates,
        status: 'repair-required',
    };
}

describe('handleRepairProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.agentProjectRepairStateStore.value = null;
        clearHandlerRegistry();
        clearUndoHistory();
        registerHandlerMap({ repairProjectData: handleRepairProjectData });
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        mocks.agentProjectRepairStateStore.value = null;
    });

    it('reports no-write when no repair is required', async () => {
        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(mocks.mutateCrdtDoc).not.toHaveBeenCalled();
        expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
    });

    it('re-asserts every conflicted path and re-projects the document', async () => {
        setRepairState([
            {
                kind: 'choose-automerge-conflict-value',
                conflictIds: ['conflict-gain'],
                path: ['targets', 'track-bass', 'gain'],
                targetIds: ['track-bass'],
            },
            {
                kind: 'choose-automerge-conflict-value',
                conflictIds: ['conflict-name'],
                path: ['markers', 'verse', 'name'],
                targetIds: ['verse'],
            },
        ]);
        // The re-projection is what clears the gate; simulate a healthy document.
        mocks.projectCrdtToStores.mockImplementation(() => {
            mocks.agentProjectRepairStateStore.value = null;
        });

        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(mocks.mutateCrdtDoc).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'root',
                message: 'Repair project data: keep the resolved value of each conflicted field',
            })
        );
        const changeFn = mocks.mutateCrdtDoc.mock.calls[0]?.[0]?.changeFn as
            ((draft: Record<string | number, unknown>) => void) | undefined;
        if (!changeFn) {
            throw new Error('Expected the repair to mutate the document');
        }
        const reasserted: Array<[string | number, unknown]> = [];
        const recordSet = (target: Record<string, unknown>) =>
            new Proxy(target, {
                set(t, key, value) {
                    if (typeof key === 'string') {
                        reasserted.push([key, value]);
                        Reflect.set(t, key, value);
                    }
                    return true;
                },
            });
        const draft = {
            markers: { verse: recordSet({ name: 'Verse' }) },
            targets: { 'track-bass': recordSet({ gain: 0.6 }) },
        };
        changeFn(draft);
        // Each conflicted leaf is re-assigned the value it already holds.
        expect(reasserted).toEqual([
            ['gain', 0.6],
            ['name', 'Verse'],
        ]);

        expect(mocks.projectCrdtToStores).toHaveBeenCalledWith({ resetProjections: true });
    });

    it('re-projects without touching the document when the only candidates are invariant repairs', async () => {
        setRepairState([{ kind: 'repair-project-invariants', targetIds: ['@project/raw/transport'] }]);
        mocks.projectCrdtToStores.mockImplementation(() => {
            mocks.agentProjectRepairStateStore.value = null;
        });

        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(mocks.mutateCrdtDoc).not.toHaveBeenCalled();
        expect(mocks.projectCrdtToStores).toHaveBeenCalledWith({ resetProjections: true });
    });

    it('reports a conflict when the re-projection leaves the gate up', async () => {
        setRepairState([
            {
                kind: 'choose-automerge-conflict-value',
                conflictIds: ['conflict-gain'],
                path: ['targets', 'track-bass', 'gain'],
                targetIds: ['track-bass'],
            },
        ]);
        mocks.projectCrdtToStores.mockImplementation(() => {
            // The document is still unhealthy after the repair attempt.
        });

        await expect(executeAppAction({ type: 'repairProjectData' })).rejects.toThrow(
            'Action conflicts with current project state: repairProjectData'
        );
    });

    it('is admitted through the repair gate while every other action is refused', async () => {
        setRepairState([{ kind: 'repair-project-invariants', targetIds: [] }]);
        mocks.projectCrdtToStores.mockImplementation(() => {
            mocks.agentProjectRepairStateStore.value = null;
        });
        registerHandlerMap({
            setTrackPan: {
                describe: () => ({ label: 'Set pan' }),
                execute: () => ({ status: 'written' }),
                undoable: true,
            },
        });

        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { expectedPan: 0, pan: 0.5, trackId: 't' } })
        ).rejects.toThrow('Action conflicts with current project state: setTrackPan');

        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        // The gate is down once the repair lands, so the same action is admitted.
        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { expectedPan: 0, pan: 0.5, trackId: 't' } })
        ).resolves.toBeUndefined();
        expect(undoStore.value?.past.length).toBeGreaterThan(0);
    });
});
