import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActionHandler, type HandlerExecutionResult } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../../models/VersionedCommandBatchEnvelope';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { commandRuntimeRepairPort } from '../commandRuntimeRepairPort';
import { createVerifiedBatchReceipt } from '../createVerifiedBatchReceipt';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { createVersionedCommandReceipt } from '../createVersionedCommandReceipt';
import { getCommandBatchContentHash } from '../getCommandBatchContentHash';
import { reconcileProjectCommandBatchEffects } from '../reconcileProjectCommandBatchEffects';

const baseRevision = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});
const capturedRevision = 'captured-live-revision';

type PreviewWorkspaceDouble = {
    document: Record<string, unknown>;
    name: 'recovery' | 'current';
    getProjectDocument: () => Record<string, unknown>;
    release: ReturnType<typeof vi.fn<() => void>>;
    scope: <Result>(callback: () => Result) => Result;
};

type EffectShape =
    { kind: 'runtime-graph'; remediation: 'retry' } | { kind: 'external-effect'; remediation: 'reconcile' };

const exactRetryFailure = {
    'external-effect': 'Pending external effect cannot be retried exactly',
    'runtime-graph': 'Pending runtime effect cannot be retried exactly',
} as const;

describe('reconcileProjectCommandBatchEffects exact retry against the live project', () => {
    let activeWorkspace: PreviewWorkspaceDouble | null;
    let currentBehavior: (workspace: PreviewWorkspaceDouble) => Pick<HandlerExecutionResult, 'status'>;
    let recoveryWorkspace: PreviewWorkspaceDouble;
    let currentWorkspace: PreviewWorkspaceDouble;
    let reconcile: ReturnType<typeof vi.fn<() => void>>;
    let afterRecoveryWorkspaceReleased: () => void;
    let createCurrent: ReturnType<typeof vi.fn<(revision: string) => PreviewWorkspaceDouble>>;
    let repairRuntime: ReturnType<typeof vi.fn<() => void>>;

    function createWorkspace(name: PreviewWorkspaceDouble['name']): PreviewWorkspaceDouble {
        const workspace: PreviewWorkspaceDouble = {
            document: { tracks: [] },
            name,
            getProjectDocument: () => workspace.document,
            release: vi.fn(() => {
                if (name === 'recovery') {
                    afterRecoveryWorkspaceReleased();
                }
            }),
            scope: (callback) => {
                activeWorkspace = workspace;
                try {
                    return callback();
                } finally {
                    activeWorkspace = null;
                }
            },
        };
        return workspace;
    }

    function createIsolatedHandler(): ActionHandler {
        return {
            previewExecution: 'isolated-project',
            describe: () => ({ label: 'Undo' }),
            undoable: false,
            execute: () => {
                if (!activeWorkspace) {
                    throw new Error('The handler ran outside a preview workspace scope');
                }
                if (activeWorkspace.name === 'recovery') {
                    return { status: 'written', afterCommit: reconcile, afterAmbiguousCommit: reconcile };
                }
                return currentBehavior(activeWorkspace);
            },
        };
    }

    // The recovery pass applies the same handler checks, so a handler that
    // cannot preview exactly only reaches the live-project pass when the
    // registration changes between the two passes.
    function replaceHandler(handler: ActionHandler): void {
        clearHandlerRegistry();
        registerHandlerMap({ undo: handler });
    }

    function createUndoCommand() {
        return createVersionedCommandEnvelope({
            action: { type: 'undo' },
            availableDeviceVersions: {},
            applicationAssignedIds: [],
            expectedEffect: 'Undo the last edit.',
            normalizedProjectRevision: baseRevision,
            objectReferences: [],
            parameterUnits: [],
            reason: 'Step back one edit.',
            time: [],
        });
    }

    async function reconcileBatch(effect: EffectShape, options: { leadingCommandsWithoutEffect?: number } = {}) {
        const leadingCommands = Array.from({ length: options.leadingCommandsWithoutEffect ?? 0 }, createUndoCommand);
        const command = createUndoCommand();
        const commands = [...leadingCommands, command];
        const envelope: VersionedCommandBatchEnvelope = {
            schemaVersion: 1,
            runId: 'run-exact-retry',
            batchId: 'batch-exact-retry',
            projectId: 'project-exact-retry',
            baseRevision,
            idempotencyKey: 'exact-retry-request',
            intent: 'Undo',
            mode: 'commit',
            scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            preconditions: [],
            commands,
            postconditions: [],
            dependencies: [],
            batchLocalBindings: [],
            grants: {
                allowedOperationPrefixes: ['undo'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: {
                maxCommands: commands.length,
                maxCreatedTracks: 0,
                maxDeletedObjects: 0,
                maxAffectedTracks: 0,
                maxAffectedClips: 0,
                maxAutomationPoints: 0,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
            },
        };
        const contentHash = await getCommandBatchContentHash(envelope);
        const receipt = createVerifiedBatchReceipt({
            contentHash,
            envelope,
            observedBaseRevision: baseRevision,
            resultingRevision: baseRevision,
            result: {
                status: 'committed-with-warning',
                actions: commands.map((envelopeCommand) => ({
                    action: { type: 'undo' as const },
                    receipt: createVersionedCommandReceipt({ envelope: envelopeCommand }),
                })),
                warning: 'The project commit succeeded, but an effect is pending.',
                warningDetails: [
                    {
                        kind: 'external-effect',
                        commandId: command.commandId,
                        message: 'An effect is pending.',
                        pendingEffect: {
                            commandId: command.commandId,
                            operation: 'undo',
                            reason: 'An effect is pending.',
                            state: 'pending',
                            ...effect,
                        },
                    },
                ],
            },
        });
        return reconcileProjectCommandBatchEffects({
            contentHash,
            envelope,
            serializedReceipt: JSON.stringify(receipt),
        });
    }

    beforeEach(() => {
        clearHandlerRegistry();
        activeWorkspace = null;
        afterRecoveryWorkspaceReleased = () => undefined;
        currentBehavior = () => ({ status: 'written' });
        reconcile = vi.fn();
        recoveryWorkspace = createWorkspace('recovery');
        currentWorkspace = createWorkspace('current');
        createCurrent = vi.fn(() => currentWorkspace);
        repairRuntime = vi.fn();
        commandProjectRevisionPort.setProvider(vi.fn(() => capturedRevision));
        commandBatchPreviewPort.setRecoveryProvider(vi.fn(() => recoveryWorkspace));
        commandBatchPreviewPort.setProvider(createCurrent);
        commandRuntimeRepairPort.setProvider(repairRuntime);
        registerHandlerMap({ undo: createIsolatedHandler() });
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandProjectRevisionPort.setProvider(null);
    });

    it('reconciles an exact retry that leaves the live document unchanged', async () => {
        await expect(reconcileBatch({ kind: 'external-effect', remediation: 'reconcile' })).resolves.toEqual({
            status: 'reconciled',
        });

        expect(createCurrent).toHaveBeenCalledExactlyOnceWith(capturedRevision);
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
        expect(reconcile).toHaveBeenCalledOnce();
        expect(repairRuntime).not.toHaveBeenCalled();
    });

    it('refuses an exact retry whose handler changes the live document, and still releases the workspace', async () => {
        currentBehavior = (workspace) => {
            workspace.document = { tracks: [{ id: 'track-1' }] };
            return { status: 'written' };
        };

        await expect(reconcileBatch({ kind: 'external-effect', remediation: 'reconcile' })).resolves.toEqual({
            status: 'failed',
            reason: exactRetryFailure['external-effect'],
        });

        expect(createCurrent).toHaveBeenCalledExactlyOnceWith(capturedRevision);
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
        expect(reconcile).not.toHaveBeenCalled();
    });

    it('refuses an exact retry that reports a conflict with the live document', async () => {
        currentBehavior = () => ({ status: 'conflict' });

        await expect(reconcileBatch({ kind: 'external-effect', remediation: 'reconcile' })).resolves.toEqual({
            status: 'failed',
            reason: exactRetryFailure['external-effect'],
        });

        expect(currentWorkspace.release).toHaveBeenCalledOnce();
        expect(reconcile).not.toHaveBeenCalled();
        expect(repairRuntime).not.toHaveBeenCalled();
    });

    it('retries only the command with a pending effect when earlier commands carry none', async () => {
        const executedActionIndexes: number[] = [];
        const isolatedHandler = createIsolatedHandler();
        replaceHandler({
            ...isolatedHandler,
            execute: (action, context) => {
                if (activeWorkspace?.name === 'current') {
                    executedActionIndexes.push(context?.actionIndex ?? -1);
                }
                return isolatedHandler.execute(action, context);
            },
        } as ActionHandler);

        await expect(
            reconcileBatch({ kind: 'external-effect', remediation: 'reconcile' }, { leadingCommandsWithoutEffect: 2 })
        ).resolves.toEqual({ status: 'reconciled' });

        expect(executedActionIndexes).toEqual([2]);
        expect(reconcile).toHaveBeenCalledOnce();
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
    });

    it('repairs a runtime-graph effect whose exact retry reports a conflict', async () => {
        currentBehavior = () => ({ status: 'conflict' });

        await expect(reconcileBatch({ kind: 'runtime-graph', remediation: 'retry' })).resolves.toEqual({
            status: 'reconciled',
        });

        expect(repairRuntime).toHaveBeenCalledOnce();
        expect(reconcile).not.toHaveBeenCalled();
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
    });

    it('routes a runtime-graph effect to runtime repair when the live handler cannot preview exactly', async () => {
        const runtimeHandler: ActionHandler = { ...createIsolatedHandler(), executionKind: 'runtime' };
        afterRecoveryWorkspaceReleased = () => replaceHandler(runtimeHandler);

        await expect(reconcileBatch({ kind: 'runtime-graph', remediation: 'retry' })).resolves.toEqual({
            status: 'reconciled',
        });

        expect(repairRuntime).toHaveBeenCalledOnce();
        expect(reconcile).not.toHaveBeenCalled();
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
    });

    it('routes a runtime-graph effect to runtime repair when the live handler is not isolated-project', async () => {
        const externalHandler: ActionHandler = {
            previewExecution: 'unsupported-external',
            describe: () => ({ label: 'Undo' }),
            undoable: false,
            execute: () => ({ status: 'written' }),
        };
        afterRecoveryWorkspaceReleased = () => replaceHandler(externalHandler);

        await expect(reconcileBatch({ kind: 'runtime-graph', remediation: 'retry' })).resolves.toEqual({
            status: 'reconciled',
        });

        expect(repairRuntime).toHaveBeenCalledOnce();
        expect(reconcile).not.toHaveBeenCalled();
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
    });

    it('refuses an external effect when the live handler cannot preview exactly', async () => {
        const externalHandler: ActionHandler = {
            previewExecution: 'unsupported-external',
            describe: () => ({ label: 'Undo' }),
            undoable: false,
            execute: () => ({ status: 'written' }),
        };
        afterRecoveryWorkspaceReleased = () => replaceHandler(externalHandler);

        await expect(reconcileBatch({ kind: 'external-effect', remediation: 'reconcile' })).resolves.toEqual({
            status: 'failed',
            reason: exactRetryFailure['external-effect'],
        });

        expect(repairRuntime).not.toHaveBeenCalled();
        expect(reconcile).not.toHaveBeenCalled();
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
    });

    it('refuses an external effect when the live handler is a runtime handler', async () => {
        const runtimeHandler: ActionHandler = { ...createIsolatedHandler(), executionKind: 'runtime' };
        afterRecoveryWorkspaceReleased = () => replaceHandler(runtimeHandler);

        await expect(reconcileBatch({ kind: 'external-effect', remediation: 'reconcile' })).resolves.toEqual({
            status: 'failed',
            reason: exactRetryFailure['external-effect'],
        });

        expect(repairRuntime).not.toHaveBeenCalled();
        expect(currentWorkspace.release).toHaveBeenCalledOnce();
    });
});
