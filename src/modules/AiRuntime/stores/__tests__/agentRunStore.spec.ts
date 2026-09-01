import { beforeEach, describe, expect, it } from 'vitest';

import {
    type AgentRunPendingEffectRecovery,
    type AgentRunPreparedStemImportRecoveryCapsule,
} from '../../models/AgentRun';
import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { persistAgentRunState, readAgentRunState, sanitizeAgentRunState } from '../agentRunStore';
import { selectAgentRunPendingEffectRecoveries } from '../selectAgentRunPendingEffectRecoveries';

const grants = {
    allowedOperationPrefixes: ['copyMidiArticulations'],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};

const pointTargetScope = {
    targetIds: ['clip-chorus-two'],
    targetRanges: [{ startBeat: 4, endBeat: 4 }],
    protectedTargetIds: ['clip-chorus-one'],
    protectedRanges: [{ startBeat: 0, endBeat: 4 }],
};

const commandBatchAuthority = {
    projectId: 'project-1',
    baseRevision: 'revision-1',
    scope: pointTargetScope,
    grants,
    budgets: {
        maxCommands: 1,
        maxCreatedTracks: 0,
        maxDeletedObjects: 0,
        maxAffectedTracks: 1,
        maxAffectedClips: 0,
        maxAutomationPoints: 0,
        maxImportedAssets: 0,
        maxRenderJobs: 0,
    },
};

function createPreparedStemRecoveryCapsule(index: number): AgentRunPreparedStemImportRecoveryCapsule {
    return {
        schemaVersion: 1,
        runId: `evicted-run-${String(index)}`,
        batchId: `prepared-batch-${String(index)}`,
        serializedCommandBatch: `serialized-batch-${String(index)}`,
        resources: [
            {
                audioBufferId: `prepared-buffer-${String(index)}`,
                assetLeaseId: `prepared-lease-${String(index)}`,
            },
        ],
        status: 'pending',
        lastError: null,
        manualRepairRequiredAt: null,
    };
}

describe('agentRunStore', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('persists point target ranges in root, plan, and decision scope records', () => {
        agentRunLifecycle.create({
            runId: 'point-target-run',
            request: 'Copy a single articulation onset.',
            mode: 'macro',
            createdRevision: 'revision-1',
            scope: pointTargetScope,
            grants,
            budgets: { limits: {}, consumed: {} },
            createdAt: 1,
        });
        agentRunLifecycle.recordPlan({
            runId: 'point-target-run',
            summary: 'Copy the selected articulation onset.',
            commandIds: ['copy-midi-articulations'],
            serializedBatchIdentity: 'batch-1',
            revision: 'revision-1',
            scope: pointTargetScope,
            grants,
            budgets: { limits: {}, consumed: {} },
            recordedAt: 2,
        });
        agentRunLifecycle.recordDecision({
            runId: 'point-target-run',
            decision: {
                decisionId: 'decision-1',
                capabilitySchemaIdentity: 'capability-1',
                proposalIdentity: 'proposal-1',
                budgets: { limits: {}, consumed: {} },
                revision: 'revision-1',
                scope: pointTargetScope,
                grants,
                alternatives: [],
                reason: 'The exact source and target notes are unambiguous.',
                selectedAlternativeId: null,
                resumeAttemptId: null,
            },
            recordedAt: 3,
        });

        const run = agentRunLifecycle.get('point-target-run');
        expect(run?.scope.targetRanges).toEqual([{ startBeat: 4, endBeat: 4 }]);
        expect(run?.plan?.scope.targetRanges).toEqual([{ startBeat: 4, endBeat: 4 }]);
        expect(run?.decision?.scope.targetRanges).toEqual([{ startBeat: 4, endBeat: 4 }]);
    });

    it('rejects point protected ranges and negative target ranges', () => {
        expect(() =>
            agentRunLifecycle.create({
                runId: 'point-protected-run',
                request: 'Reject a point protected range.',
                mode: 'macro',
                createdRevision: 'revision-1',
                scope: {
                    ...pointTargetScope,
                    protectedRanges: [{ startBeat: 4, endBeat: 4 }],
                },
                grants,
                budgets: { limits: {}, consumed: {} },
                createdAt: 1,
            })
        ).toThrow('Agent run state contains data outside the persistent schema bounds');

        expect(() =>
            agentRunLifecycle.create({
                runId: 'negative-target-run',
                request: 'Reject a negative target range.',
                mode: 'macro',
                createdRevision: 'revision-1',
                scope: {
                    ...pointTargetScope,
                    targetRanges: [{ startBeat: -1, endBeat: 0 }],
                },
                grants,
                budgets: { limits: {}, consumed: {} },
                createdAt: 1,
            })
        ).toThrow('Agent run state contains data outside the persistent schema bounds');
    });

    it('rejects malformed and duplicate prepared-stem recovery capsules', () => {
        const capsule = createPreparedStemRecoveryCapsule(0);
        const emptyState = { schemaVersion: 1, runs: [] };

        expect(
            sanitizeAgentRunState({
                ...emptyState,
                preparedStemImportRecoveryLedger: [capsule, capsule],
            })
        ).toEqual(emptyState);
        expect(
            sanitizeAgentRunState({
                ...emptyState,
                preparedStemImportRecoveryLedger: [
                    capsule,
                    {
                        ...createPreparedStemRecoveryCapsule(1),
                        resources: capsule.resources,
                    },
                ],
            })
        ).toEqual(emptyState);
        expect(
            sanitizeAgentRunState({
                ...emptyState,
                preparedStemImportRecoveryLedger: [
                    {
                        ...capsule,
                        status: 'manual-repair',
                        lastError: null,
                        manualRepairRequiredAt: null,
                    },
                ],
            })
        ).toEqual(emptyState);
    });

    it('refuses a new unresolved capsule instead of evicting recovery at capacity', () => {
        const admittedCapsules = Array.from({ length: 256 }, (_, index) => createPreparedStemRecoveryCapsule(index));
        const emptyState = { schemaVersion: 1, runs: [] };

        expect(
            sanitizeAgentRunState({
                ...emptyState,
                preparedStemImportRecoveryLedger: admittedCapsules,
            })
        ).toEqual({
            ...emptyState,
            preparedStemImportRecoveryLedger: admittedCapsules,
        });
        expect(
            sanitizeAgentRunState({
                ...emptyState,
                preparedStemImportRecoveryLedger: [
                    ...admittedCapsules,
                    createPreparedStemRecoveryCapsule(admittedCapsules.length),
                ],
            })
        ).toEqual(emptyState);

        persistAgentRunState({
            schemaVersion: 1,
            runs: [],
            preparedStemImportRecoveryLedger: admittedCapsules,
        });

        expect(() =>
            persistAgentRunState({
                ...readAgentRunState(),
                preparedStemImportRecoveryLedger: [
                    ...admittedCapsules,
                    createPreparedStemRecoveryCapsule(admittedCapsules.length),
                ],
            })
        ).toThrow('Agent run prepared-stem recovery ledger reached its persistent capacity');
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toHaveLength(256);
        expect(readAgentRunState().preparedStemImportRecoveryLedger?.[0]).toEqual(admittedCapsules[0]);
    });

    it('hydrates legacy reconcile pending-effect recoveries as manual non-actionable guidance', () => {
        agentRunLifecycle.create({
            runId: 'legacy-run',
            request: 'Recover a legacy pending external effect.',
            mode: 'macro',
            createdRevision: 'revision-1',
            scope: pointTargetScope,
            grants,
            budgets: { limits: {}, consumed: {} },
            createdAt: 1,
        });
        const legacyRecovery = {
            runId: 'legacy-run',
            checkpoint: 'durable',
            batchId: 'batch-legacy',
            effects: [
                {
                    commandId: 'command-add-device',
                    kind: 'external-effect',
                    operation: 'addDevice',
                    reason: 'Runtime graph follow-up remained pending.',
                    remediation: 'reconcile',
                    state: 'pending',
                },
            ],
            receiptIdentity: '1:legacy-run:batch-legacy:partially-committed',
            recovery: 'reconcile-batch',
            serializedBatch: 'serialized-batch',
            authority: commandBatchAuthority,
            lastError: null,
        } satisfies AgentRunPendingEffectRecovery;

        persistAgentRunState({
            ...readAgentRunState(),
            pendingEffectRecoveryLedger: [legacyRecovery],
        });

        const hydratedState = readAgentRunState();
        expect(hydratedState.pendingEffectRecoveryLedger?.[0]).toMatchObject({
            recovery: 'manual-repair',
            lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });
        expect(selectAgentRunPendingEffectRecoveries(hydratedState)).toEqual([
            expect.objectContaining({
                runId: 'legacy-run',
                batchId: 'batch-legacy',
                recovery: 'manual-repair',
                lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
                effects: legacyRecovery.effects,
            }),
        ]);
    });
});
