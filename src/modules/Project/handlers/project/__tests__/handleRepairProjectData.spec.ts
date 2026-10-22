import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
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
    rolling: false,
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    isTransportIdle: () => !mocks.rolling,
    stopPlayback: mocks.stopPlayback,
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
        mocks.rolling = false;
        mocks.stopPlayback.mockImplementation(() => {
            mocks.rolling = false;
            return Promise.resolve();
        });
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

    it('stops a rolling transport before the projection resets the transport store', async () => {
        setRepairState([{ kind: 'repair-project-invariants', targetIds: [] }]);
        mocks.rolling = true;
        let rollingAtProjection: boolean | null = null;
        mocks.projectCrdtToStores.mockImplementation(() => {
            rollingAtProjection = mocks.rolling;
            mocks.agentProjectRepairStateStore.value = null;
        });

        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(mocks.stopPlayback).toHaveBeenCalledOnce();
        expect(rollingAtProjection).toBe(false);
        expect(mocks.stopPlayback.mock.invocationCallOrder[0]!).toBeLessThan(
            mocks.projectCrdtToStores.mock.invocationCallOrder[0]!
        );
    });

    it('waits for the take commit of the stopped transport before the repair resolves', async () => {
        setRepairState([{ kind: 'repair-project-invariants', targetIds: [] }]);
        mocks.rolling = true;
        const flush = Promise.withResolvers<void>();
        mocks.stopPlayback.mockImplementationOnce(() => {
            mocks.rolling = false;
            return flush.promise;
        });
        mocks.projectCrdtToStores.mockImplementation(() => {
            mocks.agentProjectRepairStateStore.value = null;
        });
        let settled = false;

        const repair = executeAppAction({ type: 'repairProjectData' }).then(() => {
            settled = true;
        });
        await vi.waitFor(() => expect(mocks.projectCrdtToStores).toHaveBeenCalledOnce());
        await Promise.resolve();
        expect(settled).toBe(false);
        flush.resolve();

        await repair;
        expect(settled).toBe(true);
    });

    it('reports a failed transport teardown when the repair itself is refused', async () => {
        setRepairState([{ kind: 'repair-project-invariants', targetIds: [] }]);
        mocks.rolling = true;
        mocks.stopPlayback.mockRejectedValueOnce(new Error('recorder flush failed'));
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        // The re-projection leaves the gate up, so the dispatch never reaches the awaiting hooks.
        mocks.projectCrdtToStores.mockImplementation(() => undefined);

        await expect(executeAppAction({ type: 'repairProjectData' })).rejects.toThrow(
            'Action conflicts with current project state: repairProjectData'
        );
        await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());

        expect(warn.mock.calls[0]?.[0]).toMatchObject({
            message: 'Transport teardown failed during project repair',
        });
        warn.mockRestore();
    });

    it('leaves an idle transport alone', async () => {
        setRepairState([{ kind: 'repair-project-invariants', targetIds: [] }]);
        mocks.projectCrdtToStores.mockImplementation(() => {
            mocks.agentProjectRepairStateStore.value = null;
        });

        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(mocks.stopPlayback).not.toHaveBeenCalled();
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
