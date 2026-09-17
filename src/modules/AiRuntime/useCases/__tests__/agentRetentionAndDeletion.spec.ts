import { beforeEach, describe, expect, it } from 'vitest';

import {
    AGENT_CHAT_RETENTION_POLICY,
    AGENT_RUN_RETENTION_POLICY,
    AI_ACTION_HISTORY_RETENTION_POLICY,
} from '../../models/AgentRetentionPolicy';
import {
    AGENT_RUN_PREPARED_STEM_IMPORT_RECOVERY_SCHEMA_VERSION,
    AGENT_RUN_SCHEMA_VERSION,
    type AgentRun,
    type AgentRunPendingEffectRecovery,
    type AgentRunPreparedStemImportRecoveryCapsule,
    type AgentRunState,
} from '../../models/AgentRun';
import { applyAgentRunRetention, persistAgentRunState, readAgentRunState } from '../../stores/agentRunStore';
import { aiActionHistoryStore, pushAiActionGroup, type AiActionGroup } from '../../stores/aiActionHistoryStore';
import { appendChatMessage, chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { deleteAgentRun } from '../deleteAgentRun';
import { deleteAgentRunArtifacts } from '../deleteAgentRunArtifacts';

const NOW = 1_800_000_000_000;
const SECOND_MS = 1000;

function requiredAgeBound(policyName: string, maxAgeMs: number | null): number {
    if (maxAgeMs === null) {
        throw new Error(`${policyName} declares no age bound`);
    }
    return maxAgeMs;
}

const RUN_MAX_AGE_MS = requiredAgeBound('AGENT_RUN_RETENTION_POLICY', AGENT_RUN_RETENTION_POLICY.maxAgeMs);
const HISTORY_MAX_AGE_MS = requiredAgeBound(
    'AI_ACTION_HISTORY_RETENTION_POLICY',
    AI_ACTION_HISTORY_RETENTION_POLICY.maxAgeMs
);

function startRun(runId: string, at: number): AgentRun {
    expect(
        agentRunLifecycle.create({
            runId,
            request: `Retention fixture for ${runId}`,
            mode: 'plan',
            createdRevision: 'revision-1',
            createdAt: at,
        })
    ).toEqual({ status: 'created' });
    return agentRunLifecycle.transitionPhase({ runId, phase: 'planning', transitionedAt: at });
}

function createCompletedRun(runId: string, at: number): AgentRun {
    startRun(runId, at);
    return agentRunLifecycle.transitionPhase({ runId, phase: 'completed', transitionedAt: at });
}

function createCompletedRunWithReleasedAsset(runId: string, at: number): AgentRun {
    startRun(runId, at);
    agentRunLifecycle.registerTemporaryAsset({
        runId,
        assetId: `${runId}-preview.wav`,
        kind: 'render',
        cleanupOwner: `${runId}-owner`,
        createdAt: at,
    });
    agentRunLifecycle.prepareTemporaryAssetCleanup({
        runId,
        assetId: `${runId}-preview.wav`,
        cleanupOwner: `${runId}-owner`,
        preparedAt: at,
    });
    agentRunLifecycle.releaseTemporaryAsset({
        runId,
        assetId: `${runId}-preview.wav`,
        cleanupOwner: `${runId}-owner`,
        releasedAt: at,
    });
    return agentRunLifecycle.transitionPhase({ runId, phase: 'completed', transitionedAt: at });
}

function createCompletedRunWithLiveAsset(runId: string, at: number): AgentRun {
    startRun(runId, at);
    agentRunLifecycle.registerTemporaryAsset({
        runId,
        assetId: `${runId}-preview.wav`,
        kind: 'render',
        cleanupOwner: `${runId}-owner`,
        createdAt: at,
    });
    return agentRunLifecycle.transitionPhase({ runId, phase: 'completed', transitionedAt: at });
}

function createCommittedRun(runId: string, at: number): AgentRun {
    startRun(runId, at);
    agentRunLifecycle.recordPlan({
        runId,
        summary: 'Render the chorus.',
        commandIds: ['command-1'],
        serializedBatchIdentity: 'batch-1',
        revision: 'revision-1',
        scope: { targetIds: ['track-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: ['render'],
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
        budgets: { limits: { maxRenderJobs: 1 }, consumed: { commands: 1 } },
        recordedAt: at,
    });
    agentRunLifecycle.recordError({
        runId,
        error: {
            code: 'render-retry',
            message: 'The first render attempt failed.',
            occurredAt: at,
            retriable: true,
            workId: null,
        },
    });
    agentRunLifecycle.recordArtifact({
        runId,
        kind: 'render',
        artifact: { artifactId: 'render-1', workId: 'render-work', status: 'completed', summary: 'Chorus WAV' },
        recordedAt: at,
    });
    agentRunLifecycle.recordArtifact({
        runId,
        kind: 'analysis',
        artifact: { artifactId: 'analysis-1', workId: 'analysis-work', status: 'completed', summary: 'Loudness' },
        recordedAt: at,
    });
    return agentRunLifecycle.recordCommittedWork({
        runId,
        workId: 'batch-1',
        receiptIdentity: 'receipt-1',
        revertGroupId: 'revert-1',
        renderJobIds: ['render-1'],
        completesRun: true,
        committedAt: at,
    });
}

function createTerminalRunRequiringManualResume(runId: string, at: number): AgentRun {
    startRun(runId, at);
    agentRunLifecycle.requireManualResume({
        runId,
        reason: 'The application restarted before this run finished. Start a new run from the retained request.',
        workIds: [`${runId}-work`],
        requiredAt: at,
    });
    return agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled', transitionedAt: at });
}

function createCompletedRunWithPreparedStemImport(runId: string, at: number): AgentRun {
    const assetId = `${runId}-stem.wav`;
    const cleanupOwner = 'stem-import-preparation';
    startRun(runId, at);
    agentRunLifecycle.registerTemporaryAsset({ runId, assetId, kind: 'import', cleanupOwner, createdAt: at });
    agentRunLifecycle.recordPreparedStemImportRecovery({
        runId,
        recovery: {
            schemaVersion: AGENT_RUN_PREPARED_STEM_IMPORT_RECOVERY_SCHEMA_VERSION,
            batchId: `${runId}-stem-batch`,
            serializedCommandBatch: '{}',
            resources: [{ audioBufferId: assetId, assetLeaseId: null }],
        },
        recordedAt: at,
    });
    agentRunLifecycle.prepareTemporaryAssetCleanup({ runId, assetId, cleanupOwner, preparedAt: at });
    agentRunLifecycle.releaseTemporaryAsset({ runId, assetId, cleanupOwner, releasedAt: at });
    return agentRunLifecycle.transitionPhase({ runId, phase: 'completed', transitionedAt: at });
}

function preparedStemImportLedger(): AgentRunPreparedStemImportRecoveryCapsule[] {
    return readAgentRunState().preparedStemImportRecoveryLedger ?? [];
}

function cloneRun(template: AgentRun, runId: string, updatedAt: number): AgentRun {
    return { ...structuredClone(template), runId, updatedAt };
}

function stateOf(runs: AgentRun[], ledger?: AgentRunPendingEffectRecovery[]): AgentRunState {
    if (ledger === undefined) {
        return { schemaVersion: AGENT_RUN_SCHEMA_VERSION, runs };
    }
    return { schemaVersion: AGENT_RUN_SCHEMA_VERSION, runs, pendingEffectRecoveryLedger: ledger };
}

function buildPendingEffectRecovery(runId: string): AgentRunPendingEffectRecovery {
    return {
        runId,
        checkpoint: 'durable',
        batchId: `${runId}-batch`,
        effects: [
            {
                commandId: `${runId}-command`,
                kind: 'external-effect',
                operation: 'renderProjectSections',
                reason: 'The render effect never settled.',
                remediation: 'reconcile',
                state: 'pending',
            },
        ],
        receiptIdentity: `${runId}-receipt`,
        recovery: 'reconcile-batch',
        serializedBatch: '{}',
        authority: {
            projectId: 'project-retention',
            baseRevision: 'revision-1',
            scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['render'],
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
                maxCommands: 1,
                maxCreatedTracks: 0,
                maxDeletedObjects: 0,
                maxAffectedTracks: 0,
                maxAffectedClips: 0,
                maxAutomationPoints: 0,
                maxImportedAssets: 0,
                maxRenderJobs: 1,
            },
        },
        lastError: null,
    };
}

function buildActionGroup(id: string, timestamp: number): AiActionGroup {
    return { id, prompt: `prompt ${id}`, actions: [], groupId: id, timestamp, reverted: false };
}

function runIds(state: AgentRunState): string[] {
    return state.runs.map((run) => run.runId);
}

describe('agent artifact retention', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('evicts a completed run past the age bound at persist and keeps one a millisecond inside it', () => {
        createCompletedRun('run-expired', NOW - RUN_MAX_AGE_MS - 1);
        createCompletedRun('run-inside-bound', NOW - RUN_MAX_AGE_MS + 1);

        persistAgentRunState(readAgentRunState(), NOW);

        expect(runIds(readAgentRunState())).toEqual(['run-inside-bound']);
    });

    it('evicts the oldest terminal runs over the count bound and keeps every non-terminal run', () => {
        const completed = createCompletedRun('run-completed-template', NOW);
        const planning = startRun('run-planning-template', NOW);
        expect(planning.phase).toBe('planning');

        const total = AGENT_RUN_RETENTION_POLICY.maxCount + 2;
        const runs = [
            cloneRun(planning, 'run-active-0', NOW - total * SECOND_MS),
            cloneRun(planning, 'run-active-1', NOW - (total - 1) * SECOND_MS),
            ...Array.from({ length: total - 2 }, (_unused, offset) =>
                cloneRun(completed, `run-terminal-${offset}`, NOW - (total - 2 - offset) * SECOND_MS)
            ),
        ];

        const retained = applyAgentRunRetention(stateOf(runs), NOW);

        expect(retained.runs).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds(retained)).toContain('run-active-0');
        expect(runIds(retained)).toContain('run-active-1');
        expect(runIds(retained)).not.toContain('run-terminal-0');
        expect(runIds(retained)).not.toContain('run-terminal-1');
    });

    it('keeps a terminal run holding a live temporary asset and evicts a released one instead', () => {
        const live = createCompletedRunWithLiveAsset('run-live-template', NOW);
        const released = createCompletedRunWithReleasedAsset('run-released-template', NOW);
        expect(live.temporaryAssets.map((asset) => asset.status)).toEqual(['live']);
        expect(released.temporaryAssets.map((asset) => asset.status)).toEqual(['released']);

        const total = AGENT_RUN_RETENTION_POLICY.maxCount + 1;
        const runs = [
            cloneRun(live, 'run-live', NOW - total * SECOND_MS),
            ...Array.from({ length: total - 1 }, (_unused, offset) =>
                cloneRun(released, `run-released-${offset}`, NOW - (total - 1 - offset) * SECOND_MS)
            ),
        ];

        const retained = applyAgentRunRetention(stateOf(runs), NOW);

        expect(retained.runs).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds(retained)).toContain('run-live');
        expect(runIds(retained)).not.toContain('run-released-0');
    });

    it('purges an aged run that committed work and removes an aged run that committed none', () => {
        const aged = NOW - RUN_MAX_AGE_MS - 1;
        const committed = createCommittedRun('run-committed-template', NOW);
        const completed = createCompletedRun('run-uncommitted-template', NOW);
        persistAgentRunState(
            stateOf([cloneRun(committed, 'run-committed', aged), cloneRun(completed, 'run-uncommitted', aged)]),
            aged
        );
        const before = agentRunLifecycle.get('run-committed');
        expect(before?.request).not.toBe('');
        expect(before?.committedWork).toHaveLength(1);

        persistAgentRunState(readAgentRunState(), NOW);

        const retained = readAgentRunState();
        expect(runIds(retained)).toEqual(['run-committed']);
        const purged = retained.runs.at(0);
        expect(purged?.updatedAt).toBe(aged);
        expect(purged?.request).toBe('');
        expect(purged?.plan).toBeNull();
        expect(purged?.committedWork).toEqual(before?.committedWork);
        expect(purged?.receipts).toEqual(before?.receipts);
        expect(purged?.renders).toEqual(before?.renders);
    });

    it('evicts a younger uncommitted run over the count bound before an older committed one', () => {
        const committed = createCommittedRun('run-committed-template', NOW);
        const completed = createCompletedRun('run-uncommitted-template', NOW);

        const total = AGENT_RUN_RETENTION_POLICY.maxCount + 1;
        const runs = [
            cloneRun(committed, 'run-committed', NOW - total * SECOND_MS),
            ...Array.from({ length: total - 1 }, (_unused, offset) =>
                cloneRun(completed, `run-uncommitted-${offset}`, NOW - (total - 1 - offset) * SECOND_MS)
            ),
        ];

        const retained = applyAgentRunRetention(stateOf(runs), NOW);

        expect(retained.runs).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds(retained)).toContain('run-committed');
        expect(runIds(retained)).not.toContain('run-uncommitted-0');
    });

    it('keeps a terminal run that still requires a manual resume past both bounds', () => {
        const manual = createTerminalRunRequiringManualResume('run-manual-template', NOW);
        expect(manual.phase).toBe('cancelled');
        expect(manual.manualResume.required).toBe(true);
        expect(manual.temporaryAssets).toEqual([]);
        const completed = createCompletedRun('run-completed-template', NOW);

        const total = AGENT_RUN_RETENTION_POLICY.maxCount + 1;
        const runs = [
            cloneRun(manual, 'run-manual', NOW - RUN_MAX_AGE_MS - 1),
            ...Array.from({ length: total - 1 }, (_unused, offset) =>
                cloneRun(completed, `run-terminal-${offset}`, NOW - (total - 1 - offset) * SECOND_MS)
            ),
        ];

        const retained = applyAgentRunRetention(stateOf(runs), NOW);

        expect(retained.runs).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds(retained)).toContain('run-manual');
        expect(runIds(retained)).not.toContain('run-terminal-0');
    });

    it('keeps a terminal run the prepared-stem recovery ledger still names', () => {
        const prepared = createCompletedRunWithPreparedStemImport('run-prepared', NOW);
        expect(prepared.temporaryAssets.map((asset) => asset.status)).toEqual(['released']);
        const ledger = preparedStemImportLedger();
        expect(ledger.map((recovery) => recovery.runId)).toEqual(['run-prepared']);
        const completed = createCompletedRun('run-completed-template', NOW);

        const total = AGENT_RUN_RETENTION_POLICY.maxCount + 1;
        const runs = [
            cloneRun(prepared, 'run-prepared', NOW - total * SECOND_MS),
            ...Array.from({ length: total - 1 }, (_unused, offset) =>
                cloneRun(completed, `run-terminal-${offset}`, NOW - (total - 1 - offset) * SECOND_MS)
            ),
        ];

        const retained = applyAgentRunRetention(
            { schemaVersion: AGENT_RUN_SCHEMA_VERSION, runs, preparedStemImportRecoveryLedger: ledger },
            NOW
        );

        expect(retained.runs).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds(retained)).toContain('run-prepared');
        expect(runIds(retained)).not.toContain('run-terminal-0');
    });

    it('keeps a terminal run a pending-effect recovery ledger still names', () => {
        const completed = createCompletedRun('run-completed-template', NOW);

        const total = AGENT_RUN_RETENTION_POLICY.maxCount + 1;
        const runs = Array.from({ length: total }, (_unused, offset) =>
            cloneRun(completed, `run-terminal-${offset}`, NOW - (total - offset) * SECOND_MS)
        );

        const retained = applyAgentRunRetention(stateOf(runs, [buildPendingEffectRecovery('run-terminal-0')]), NOW);

        expect(retained.runs).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds(retained)).toContain('run-terminal-0');
        expect(runIds(retained)).not.toContain('run-terminal-1');
    });

    it('drops action history groups past the age bound and keeps the newest the count bound admits', () => {
        aiActionHistoryStore.set({ groups: [], panelOpen: false });
        const overflow = AI_ACTION_HISTORY_RETENTION_POLICY.maxCount + 5;

        pushAiActionGroup(buildActionGroup('group-expired', NOW - HISTORY_MAX_AGE_MS - 1), NOW);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);

        for (let index = 0; index < overflow; index++) {
            pushAiActionGroup(buildActionGroup(`group-${index}`, NOW - (overflow - index) * SECOND_MS), NOW);
        }

        const groups = aiActionHistoryStore.value?.groups ?? [];
        expect(groups).toHaveLength(AI_ACTION_HISTORY_RETENTION_POLICY.maxCount);
        expect(groups.map((group) => group.id)).not.toContain('group-expired');
        expect(groups.at(0)?.id).toBe('group-5');
        expect(groups.at(-1)?.id).toBe(`group-${overflow - 1}`);
    });

    it('keeps the newest chat messages the count bound admits, ending with the message just appended', () => {
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'chat' });
        const overflow = AGENT_CHAT_RETENTION_POLICY.maxCount + 5;

        for (let index = 0; index < overflow; index++) {
            appendChatMessage({
                id: `message-${index}`,
                role: 'user',
                content: `line ${index}`,
                timestamp: NOW + index,
            });
        }

        const messages = chatStore.value?.messages ?? [];
        expect(messages).toHaveLength(AGENT_CHAT_RETENTION_POLICY.maxCount);
        expect(messages.at(0)?.id).toBe('message-5');
        expect(messages.at(-1)?.id).toBe(`message-${overflow - 1}`);
    });
});

describe('deleteAgentRun', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('reports a missing run and refuses one that still proposes work', async () => {
        await expect(deleteAgentRun('run-unknown', NOW)).resolves.toEqual({ status: 'missing' });

        startRun('run-executing', NOW);
        agentRunLifecycle.transitionPhase({ runId: 'run-executing', phase: 'executing', transitionedAt: NOW });
        const before = agentRunLifecycle.get('run-executing');

        await expect(deleteAgentRun('run-executing', NOW)).resolves.toEqual({
            status: 'refused',
            reason: 'run-active',
        });
        expect(agentRunLifecycle.get('run-executing')).toEqual(before);
    });

    it('removes a completed run that committed no work and leaves unrelated runs untouched', async () => {
        createCompletedRun('run-deletable', NOW);
        createCompletedRun('run-unrelated', NOW);
        const unrelatedBefore = agentRunLifecycle.get('run-unrelated');

        await expect(deleteAgentRun('run-deletable', NOW)).resolves.toEqual({ status: 'deleted' });

        expect(agentRunLifecycle.get('run-deletable')).toBeNull();
        expect(agentRunLifecycle.get('run-unrelated')).toEqual(unrelatedBefore);
    });

    it('purges a completed run that committed work down to the evidence of that work', async () => {
        createCommittedRun('run-committed', NOW);
        createCompletedRun('run-unrelated', NOW);
        const before = agentRunLifecycle.get('run-committed');
        const unrelatedBefore = agentRunLifecycle.get('run-unrelated');
        expect(before?.phase).toBe('completed');
        expect(before?.errors).toHaveLength(1);
        expect(before?.plan).not.toBeNull();
        expect(before?.renders).toHaveLength(1);
        expect(before?.committedWork).toEqual([
            { workId: 'batch-1', receiptIdentity: 'receipt-1', revertGroupId: 'revert-1', committedAt: NOW },
        ]);

        await expect(deleteAgentRun('run-committed', NOW)).resolves.toEqual({ status: 'purged' });

        const purged = agentRunLifecycle.get('run-committed');
        expect(purged?.request).toBe('');
        expect(purged?.plan).toBeNull();
        expect(purged?.errors).toEqual([]);
        expect(purged?.analyses).toEqual([]);
        expect(purged?.committedWork).toEqual(before?.committedWork);
        expect(purged?.receipts).toEqual(before?.receipts);
        expect(purged?.renders).toEqual(before?.renders);
        expect(agentRunLifecycle.get('run-unrelated')).toEqual(unrelatedBefore);
    });

    it('refuses a run the pending-effect recovery ledger names and keeps it whole', async () => {
        createCompletedRun('run-pending-effect', NOW);
        persistAgentRunState(
            {
                ...readAgentRunState(),
                pendingEffectRecoveryLedger: [buildPendingEffectRecovery('run-pending-effect')],
            },
            NOW
        );
        const before = agentRunLifecycle.get('run-pending-effect');

        await expect(deleteAgentRun('run-pending-effect', NOW)).resolves.toEqual({
            status: 'refused',
            reason: 'recovery-pending',
        });

        expect(agentRunLifecycle.get('run-pending-effect')).toEqual(before);
    });

    it('refuses a run the prepared-stem recovery ledger names and keeps it whole', async () => {
        const before = createCompletedRunWithPreparedStemImport('run-prepared-stem', NOW);
        expect(preparedStemImportLedger().map((recovery) => recovery.runId)).toEqual(['run-prepared-stem']);

        await expect(deleteAgentRun('run-prepared-stem', NOW)).resolves.toEqual({
            status: 'refused',
            reason: 'recovery-pending',
        });

        expect(agentRunLifecycle.get('run-prepared-stem')).toEqual(before);
    });

    it('purges a committed run past the age bound and stamps the purge with the caller clock', async () => {
        const aged = NOW - RUN_MAX_AGE_MS - 1;
        const committed = createCommittedRun('run-committed-template', NOW);
        persistAgentRunState(stateOf([cloneRun(committed, 'run-committed', aged)]), aged);
        const before = agentRunLifecycle.get('run-committed');
        expect(before?.request).not.toBe('');

        await expect(deleteAgentRun('run-committed', NOW)).resolves.toEqual({ status: 'purged' });

        const purged = agentRunLifecycle.get('run-committed');
        expect(purged?.updatedAt).toBe(NOW);
        expect(purged?.request).toBe('');
        expect(purged?.committedWork).toEqual(before?.committedWork);
        expect(purged?.receipts).toEqual(before?.receipts);
    });

    it('reports a run past the age bound that committed nothing as deleted rather than missing', async () => {
        const aged = NOW - RUN_MAX_AGE_MS - 1;
        const completed = createCompletedRun('run-uncommitted-template', NOW);
        persistAgentRunState(stateOf([cloneRun(completed, 'run-uncommitted', aged)]), aged);
        expect(agentRunLifecycle.get('run-uncommitted')).not.toBeNull();

        await expect(deleteAgentRun('run-uncommitted', NOW)).resolves.toEqual({ status: 'deleted' });

        expect(agentRunLifecycle.get('run-uncommitted')).toBeNull();
    });

    it('applies retention on the caller clock when the artifact cleanup persists', async () => {
        const aged = NOW - RUN_MAX_AGE_MS - 1;
        const released = createCompletedRunWithReleasedAsset('run-asset-template', NOW);
        const completed = createCompletedRun('run-bystander-template', NOW);
        persistAgentRunState(
            stateOf([cloneRun(released, 'run-asset', NOW), cloneRun(completed, 'run-bystander', aged)]),
            aged
        );
        expect(agentRunLifecycle.get('run-bystander')).not.toBeNull();

        await expect(deleteAgentRunArtifacts('run-asset', NOW)).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: ['run-asset-template-preview.wav'],
            failedAssetIds: [],
        });

        expect(agentRunLifecycle.get('run-bystander')).toBeNull();
        expect(agentRunLifecycle.get('run-asset')?.temporaryAssets).toEqual([]);
    });

    it('reports the temporary assets their cleanup owner refused and keeps the run', async () => {
        const runId = 'run-cleanup-failure';
        startRun(runId, NOW);
        agentRunLifecycle.registerTemporaryAsset({
            runId,
            assetId: 'stuck-preview.wav',
            kind: 'render',
            cleanupOwner: 'stuck-owner',
            createdAt: NOW,
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'completed', transitionedAt: NOW });
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId,
            assetId: 'stuck-preview.wav',
            cleanupOwner: 'stuck-owner',
            cleanup: () => {
                throw new Error('disk busy');
            },
        });

        await expect(deleteAgentRun(runId, NOW)).resolves.toEqual({
            status: 'partial',
            failedAssetIds: ['stuck-preview.wav'],
        });

        expect(agentRunLifecycle.get(runId)?.temporaryAssets.map((asset) => asset.assetId)).toEqual([
            'stuck-preview.wav',
        ]);
    });
});
