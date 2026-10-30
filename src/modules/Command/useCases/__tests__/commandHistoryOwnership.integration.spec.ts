import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectMutationAuthorization,
    captureProjectRevision,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { commandBatchExecutionAuthorityPort } from '../commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from '../commandBatchIdempotencyPort';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { configureCommandBatchIdempotency } from '../configureCommandBatchIdempotency';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';
import { getActionReplayStatus } from '../getActionReplayStatus';
import { issueCommandApprovalBinding } from '../issueCommandApprovalBinding';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

const tempo = createAutomergeStorage<{ bpm: number }>('root', 'historyTempo');
const metadataPort = {
    record: recordActionHistoryEntry,
    recordBatch: recordActionHistoryEntries,
    markReverted: markActionHistoryEntryReverted,
    clear: clearActionHistory,
};

describe('command-owned durable history publication', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        resetAutomergeStorageProjections('root');
        clearActionHistory();
        tempo.set({ bpm: 120 });
        flushAutomergeStorageWrites();
        undoStore.set({ past: [], future: [] });
        resetActionReplayAuthority();
        clearHandlerRegistry();
        registerHandlerMap({
            setTempo: {
                undoable: true,
                validate: () => true,
                canReapplyAfterDivergence: () => true,
                requiresAbortCompensation: false,
                describe: () => ({ label: 'Set tempo', inverseAction: { type: 'setTempo', payload: { bpm: 120 } } }),
                execute: (action) => tempo.set({ bpm: action.payload.bpm }),
            },
        });
        setActionHistoryMetadataPort(metadataPort);
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: { request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()) },
        });
        commandBatchPreflightPort.setProvider(() => ({
            projectId: 'history-owner-project',
            audioGraphValid: true,
            projectInvariantsValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            targetFingerprints: {},
        }));
        localStorage.clear();
        configureCommandBatchIdempotency({ canExecute: () => true });
        commandProjectRevisionPort.setProvider(captureProjectRevision);
    });

    afterEach(() => {
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        commandProjectRevisionPort.setProvider(null);
        commandBatchIdempotencyPort.setRepository(null);
        commandBatchExecutionAuthorityPort.setProvider(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        commandBatchPreflightPort.setProvider(null);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function confirmedBatch(foreignWrite = false) {
        const revision = captureProjectRevision();
        const batch = compileVersionedCommandBatchEnvelope({
            runId: 'history-owner-run',
            batchId: 'history-owner-batch',
            projectId: 'history-owner-project',
            baseRevision: revision,
            intent: 'Set tempo',
            mode: 'commit',
            idempotencyKey: 'history-owner-key',
            commands: [128, 132].map((bpm) =>
                serializeVersionedCommandEnvelope(
                    createVersionedCommandEnvelope({
                        action: { type: 'setTempo', payload: { bpm } },
                        availableDeviceVersions: {},
                        expectedEffect: 'Set tempo',
                        normalizedProjectRevision: revision,
                        objectReferences: [],
                        parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
                        reason: 'Set tempo',
                        time: [],
                    })
                )
            ),
        });
        const ownsCommand = captureProjectMutationAuthorization();
        const finalized = vi.fn();
        const unavailable = vi.fn();
        const result = await executeVersionedCommandBatchEnvelope({
            ...batch,
            approvalBinding: issueCommandApprovalBinding({ ...batch, validate: () => ({ status: 'valid' }) }),
            options: {
                source: 'prompt',
                shouldExecute: ownsCommand,
                shouldFinalizeProjectCommit: ownsCommand,
                onProjectCommitFinalized: finalized,
                onProjectCommitFinalizationUnavailable: unavailable,
                onCommitted: foreignWrite
                    ? () =>
                          mutateCrdtDoc<{ actionHistory?: { foreign?: boolean } }>({
                              id: 'root',
                              changeFn: (doc) => {
                                  doc.actionHistory ??= {};
                                  doc.actionHistory.foreign = true;
                              },
                          })
                    : undefined,
            },
        });
        return { result, finalized, unavailable };
    }

    it('keeps single-command history within the handler publication owner', async () => {
        let ownsCommand: (() => boolean) | undefined;
        clearHandlerRegistry();
        registerHandlerMap({
            setTempo: {
                undoable: true,
                requiresAbortCompensation: false,
                describe: () => ({ label: 'Set tempo', inverseAction: { type: 'setTempo', payload: { bpm: 120 } } }),
                execute: (action) => {
                    ownsCommand = captureProjectMutationAuthorization();
                    expect(ownsCommand()).toBe(true);
                    tempo.set({ bpm: action.payload.bpm });
                },
            },
        });
        await executeAppAction({ type: 'setTempo', payload: { bpm: 128 } });
        expect(ownsCommand?.()).toBe(true);
        expect(getCrdtDoc<{ actionHistory: unknown }>('root')?.actionHistory).toEqual(actionHistoryStore.value);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('emits actual finalization evidence for a confirmed atomic batch with real metadata', async () => {
        setActionHistoryMetadataPort({
            ...metadataPort,
            recordBatch: (entries) => {
                const evicted = recordActionHistoryEntries(entries);
                expect(undoStore.value?.past).toEqual([]);
                for (const entry of entries) {
                    expect(getActionReplayStatus(entry.id)).toEqual({ status: 'unavailable' });
                }
                return evicted;
            },
        });
        const { result, finalized, unavailable } = await confirmedBatch();
        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(finalized).toHaveBeenCalledOnce();
        expect(finalized).toHaveBeenCalledWith(
            expect.objectContaining({
                receipt: expect.objectContaining({ outcome: 'committed', batchId: 'history-owner-batch' }),
                revision: expect.any(String),
            })
        );
        expect(unavailable).not.toHaveBeenCalled();
        expect(tempo.get()).toEqual({ bpm: 132 });
        expect(actionHistoryStore.value?.entries).toHaveLength(2);
        expect(undoStore.value?.past).toHaveLength(2);
        for (const entry of actionHistoryStore.value?.entries ?? []) {
            expect(getActionReplayStatus(entry.id)).toEqual({ status: 'ready' });
        }
    });

    it('withholds finalization for a genuine foreign history-slot write', async () => {
        const { result, finalized, unavailable } = await confirmedBatch(true);
        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(finalized).not.toHaveBeenCalled();
        expect(unavailable).toHaveBeenCalledWith({
            reason: 'The project changed outside the confirmed command before finalization evidence was recorded.',
        });
    });

    it.each(['single', 'atomic'] as const)(
        'publishes no %s session history authority when storage refuses before publication',
        async (kind) => {
            configureAutomergeStoragePort({
                getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
                getSemanticMessage: () => undefined,
                hasDoc: (id) => getCrdtDoc(id) !== undefined,
                mutateDoc: () => {
                    throw new Error('storage refused');
                },
            });
            if (kind === 'single') {
                await expect(executeAppAction({ type: 'setTempo', payload: { bpm: 128 } })).rejects.toThrow(
                    'storage refused'
                );
            } else {
                expect(
                    await executeAppActionBatch([
                        { type: 'setTempo', payload: { bpm: 128 } },
                        { type: 'setTempo', payload: { bpm: 132 } },
                    ])
                ).toMatchObject({ status: 'failed', reason: 'storage refused' });
            }
            expect(undoStore.value?.past).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(getCrdtDoc<{ historyTempo: { bpm: number } }>('root')?.historyTempo).toEqual({ bpm: 120 });
        }
    );

    it.each(['single', 'atomic'] as const)(
        'aborts partially staged %s metadata before publishing project or session history',
        async (kind) => {
            const entryIds: string[] = [];
            const record: typeof recordActionHistoryEntry = (entry) => {
                entryIds.push(entry.id);
                recordActionHistoryEntry(entry);
                throw new Error('metadata preparation failed');
            };
            setActionHistoryMetadataPort({
                ...metadataPort,
                record,
                recordBatch: (entries) => entries.flatMap(record),
            });
            if (kind === 'single') {
                await expect(executeAppAction({ type: 'setTempo', payload: { bpm: 128 } })).rejects.toThrow(
                    'metadata preparation failed'
                );
            } else {
                expect(
                    await executeAppActionBatch([
                        { type: 'setTempo', payload: { bpm: 128 } },
                        { type: 'setTempo', payload: { bpm: 132 } },
                    ])
                ).toMatchObject({ status: 'failed', reason: 'metadata preparation failed' });
            }
            expect(getCrdtDoc<{ historyTempo: { bpm: number } }>('root')?.historyTempo).toEqual({ bpm: 120 });
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
            for (const id of entryIds) expect(getActionReplayStatus(id)).toEqual({ status: 'unavailable' });
        }
    );
});
