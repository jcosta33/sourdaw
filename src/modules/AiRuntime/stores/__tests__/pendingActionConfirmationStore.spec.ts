import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
    proposePendingActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../pendingActionConfirmationStore';

describe('pendingActionConfirmationStore', () => {
    beforeEach(() => {
        clearPendingActionConfirmations();
    });

    it('preserves one materialized bus identity across a pending compound confirmation', () => {
        const busId = 'bus-ai-12345678-1234-4123-8123-123456789abc';
        const actions = [
            { type: 'createBus' as const, payload: { name: 'Vocal Plate', busId } },
            { type: 'addDevice' as const, payload: { trackId: busId, deviceType: 'builtin-reverb' } },
            {
                type: 'addSend' as const,
                payload: { trackId: 'track-vocals', busId, level: 0.25, expectedAbsent: true as const },
            },
        ];

        const confirmation = proposePendingActionConfirmation({
            id: 'confirmation-1',
            prompt: 'create a Vocal Plate bus and route Vocals to it',
            assistantMessageId: 'message-1',
            actions,
            actionLabels: ['Create bus', 'Add Reverb', 'Add send'],
            executionMode: 'atomic',
            projectRevision: 'revision-1',
        });

        expect(confirmation?.kind).toBe('app_actions');
        if (confirmation?.kind !== 'app_actions') {
            throw new Error('Expected an AppAction confirmation');
        }
        expect(confirmation.actions).toEqual(actions);
        expect(confirmation.actions[0]).toEqual({
            type: 'createBus',
            payload: { name: 'Vocal Plate', busId },
        });
    });

    it('isolates approved actions and protected targets at proposal and read boundaries', () => {
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Drum Bus', busId: 'bus-drum' },
        };
        const protectedUnchanged = [{ id: 'track-parallel', name: 'Parallel Compression' }];
        const commandEnvelopes = ['{"schemaVersion":1,"commandId":"command-1"}'];
        const commandBatch = {
            serialized: '{"schemaVersion":1,"batchId":"batch-1"}',
            authority: {
                projectId: 'project-1',
                baseRevision: 'revision-2',
                scope: {
                    targetIds: ['bus-drum'],
                    targetRanges: [],
                    protectedTargetIds: ['track-parallel'],
                    protectedRanges: [],
                },
                grants: {
                    allowedOperationPrefixes: ['createBus'],
                    create: true,
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
                    maxCommands: 1,
                    maxCreatedTracks: 1,
                    maxDeletedObjects: 0,
                    maxAffectedTracks: 1,
                    maxAffectedClips: 0,
                    maxAutomationPoints: 0,
                    maxImportedAssets: 0,
                    maxRenderJobs: 0,
                },
            },
        };
        const proposed = proposePendingActionConfirmation({
            id: 'confirmation-2',
            prompt: 'create a Drum Bus',
            assistantMessageId: 'message-2',
            actions: [action],
            actionLabels: ['Create Drum Bus'],
            commandEnvelopes,
            commandBatch,
            protectedUnchanged,
            executionMode: 'atomic',
            projectRevision: 'revision-2',
        });
        if (!proposed) {
            throw new Error('Expected a pending confirmation');
        }
        const inputProtectedTarget = protectedUnchanged[0];
        const proposedProtectedTarget = proposed.protectedUnchanged[0];
        if (!inputProtectedTarget || !proposedProtectedTarget) {
            throw new Error('Expected a protected target');
        }

        action.payload.name = 'Changed input';
        commandEnvelopes[0] = 'changed input';
        commandBatch.serialized = 'changed input';
        commandBatch.authority.scope.targetIds[0] = 'changed-input';
        inputProtectedTarget.name = 'Changed input';
        if (proposed.actions[0]?.type === 'createBus') {
            proposed.actions[0].payload.name = 'Changed read';
        }
        proposedProtectedTarget.name = 'Changed read';

        const reread = getPendingActionConfirmation(proposed.id);
        expect(reread?.actions).toEqual([{ type: 'createBus', payload: { name: 'Drum Bus', busId: 'bus-drum' } }]);
        expect(reread?.protectedUnchanged).toEqual([{ id: 'track-parallel', name: 'Parallel Compression' }]);
        expect(reread?.approvalSnapshot).toEqual({
            actions: [{ type: 'createBus', payload: { name: 'Drum Bus', busId: 'bus-drum' } }],
            actionLabels: ['Create Drum Bus'],
            commandEnvelopes: ['{"schemaVersion":1,"commandId":"command-1"}'],
            commandBatch: {
                serialized: '{"schemaVersion":1,"batchId":"batch-1"}',
                authority: {
                    projectId: 'project-1',
                    baseRevision: 'revision-2',
                    scope: {
                        targetIds: ['bus-drum'],
                        targetRanges: [],
                        protectedTargetIds: ['track-parallel'],
                        protectedRanges: [],
                    },
                    grants: {
                        allowedOperationPrefixes: ['createBus'],
                        create: true,
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
                        maxCommands: 1,
                        maxCreatedTracks: 1,
                        maxDeletedObjects: 0,
                        maxAffectedTracks: 1,
                        maxAffectedClips: 0,
                        maxAutomationPoints: 0,
                        maxImportedAssets: 0,
                        maxRenderJobs: 0,
                    },
                },
            },
            protectedUnchanged: [{ id: 'track-parallel', name: 'Parallel Compression' }],
        });
    });

    it('releases prepared resources when their confirmation is evicted or the store is cleared', () => {
        const evictedRelease = vi.fn();
        const firstInput = {
            id: 'confirmation-evicted',
            prompt: 'first',
            assistantMessageId: 'message-evicted',
            actions: [{ type: 'createBus' as const, payload: { name: 'First', busId: 'bus-first' } }],
            actionLabels: ['First'],
            projectRevision: 'revision-evicted',
            resourceLease: { bytes: 1, release: evictedRelease },
        };
        proposePendingActionConfirmation(firstInput);
        for (let index = 0; index < 20; index++) {
            proposePendingActionConfirmation({
                id: `confirmation-${String(index)}`,
                prompt: `prompt-${String(index)}`,
                assistantMessageId: `message-${String(index)}`,
                actions: [
                    { type: 'createBus', payload: { name: `Bus ${String(index)}`, busId: `bus-${String(index)}` } },
                ],
                actionLabels: [`Bus ${String(index)}`],
                projectRevision: `revision-${String(index)}`,
            });
        }
        expect(evictedRelease).toHaveBeenCalledTimes(1);

        const clearedRelease = vi.fn();
        const clearInput = {
            id: 'confirmation-cleared',
            prompt: 'clear me',
            assistantMessageId: 'message-cleared',
            actions: [{ type: 'createBus' as const, payload: { name: 'Clear', busId: 'bus-clear' } }],
            actionLabels: ['Clear'],
            projectRevision: 'revision-cleared',
            resourceLease: { bytes: 1, release: clearedRelease },
        };
        proposePendingActionConfirmation(clearInput);
        clearPendingActionConfirmations();

        expect(clearedRelease).toHaveBeenCalledTimes(1);
    });

    it('rejects prepared confirmations above the aggregate live-resource ceiling', () => {
        const firstRelease = vi.fn();
        const rejectedRelease = vi.fn();
        function createInput(id: string, release: () => void) {
            return {
                id,
                prompt: id,
                assistantMessageId: `message-${id}`,
                actions: [{ type: 'createBus' as const, payload: { name: id, busId: `bus-${id}` } }],
                actionLabels: [id],
                projectRevision: `revision-${id}`,
                resourceLease: { bytes: 1100 * 1024 * 1024, release },
            };
        }

        expect(proposePendingActionConfirmation(createInput('first', firstRelease))).not.toBeNull();
        expect(proposePendingActionConfirmation(createInput('second', rejectedRelease))).toBeNull();
        expect(firstRelease).not.toHaveBeenCalled();
        expect(rejectedRelease).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite a confirmation transition performed while an evicted resource is released', () => {
        const release = vi.fn(() => {
            updatePendingActionConfirmationStatus({ confirmationId: 'confirmation-19', status: 'accepted' });
        });
        proposePendingActionConfirmation({
            id: 'confirmation-eviction-race',
            prompt: 'evict me',
            assistantMessageId: 'message-eviction-race',
            actions: [{ type: 'createBus', payload: { name: 'Evicted', busId: 'bus-evicted' } }],
            actionLabels: ['Evicted'],
            projectRevision: 'revision-eviction-race',
            resourceLease: { bytes: 1, release },
        });
        for (let index = 0; index < 20; index += 1) {
            proposePendingActionConfirmation({
                id: `confirmation-${String(index)}`,
                prompt: `prompt-${String(index)}`,
                assistantMessageId: `message-${String(index)}`,
                actions: [{ type: 'createBus', payload: { name: 'Bus', busId: `bus-${String(index)}` } }],
                actionLabels: ['Bus'],
                projectRevision: `revision-${String(index)}`,
            });
        }

        expect(release).toHaveBeenCalledOnce();
        expect(getPendingActionConfirmation('confirmation-19')?.status).toBe('accepted');
    });

    it('retains both proposals when an eviction callback proposes another confirmation', () => {
        const nestedProposal = () =>
            proposePendingActionConfirmation({
                id: 'confirmation-nested',
                prompt: 'nested',
                assistantMessageId: 'message-nested',
                actions: [{ type: 'createBus', payload: { name: 'Nested', busId: 'bus-nested' } }],
                actionLabels: ['Nested'],
                projectRevision: 'revision-nested',
            });
        proposePendingActionConfirmation({
            id: 'confirmation-reentrant-eviction',
            prompt: 'evict me',
            assistantMessageId: 'message-reentrant-eviction',
            actions: [{ type: 'createBus', payload: { name: 'Evicted', busId: 'bus-evicted' } }],
            actionLabels: ['Evicted'],
            projectRevision: 'revision-reentrant-eviction',
            resourceLease: { bytes: 1, release: nestedProposal },
        });
        for (let index = 0; index < 19; index += 1) {
            proposePendingActionConfirmation({
                id: `confirmation-base-${String(index)}`,
                prompt: 'base',
                assistantMessageId: `message-base-${String(index)}`,
                actions: [{ type: 'createBus', payload: { name: 'Base', busId: `bus-base-${String(index)}` } }],
                actionLabels: ['Base'],
                projectRevision: `revision-base-${String(index)}`,
            });
        }
        proposePendingActionConfirmation({
            id: 'confirmation-outer',
            prompt: 'outer',
            assistantMessageId: 'message-outer',
            actions: [{ type: 'createBus', payload: { name: 'Outer', busId: 'bus-outer' } }],
            actionLabels: ['Outer'],
            projectRevision: 'revision-outer',
        });

        const ids = pendingActionConfirmationStore.value?.confirmations.map((confirmation) => confirmation.id);
        expect(ids).toContain('confirmation-outer');
        expect(ids).toContain('confirmation-nested');
    });
});
