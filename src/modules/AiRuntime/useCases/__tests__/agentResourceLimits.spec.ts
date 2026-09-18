import { beforeEach, describe, expect, it } from 'vitest';

import {
    AGENT_RESOURCE_LIMIT_CATEGORIES,
    DEFAULT_AGENT_RESOURCE_LIMITS,
    describeAgentRunHardLimit,
} from '../../models/AgentResourceLimits';
import { TOOL_PLAN_MAX_OUTPUT_TOKENS } from '../../models/HostedToolPlanLimits';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { configureAgentResourceLimits } from '../configureAgentResourceLimits';

function commandEnvelope(index: number) {
    return { operation: 'togglePlayback', objectReferences: [], arguments: { marker: index } };
}

function commandBatch(count: number) {
    return { commands: Array.from({ length: count }, (_value, index) => commandEnvelope(index)) as never };
}

function createRun(runId: string, request = 'Arrange this project.') {
    return agentRunLifecycle.create({ runId, request, mode: 'apply', createdRevision: 'revision-a' });
}

describe('agent resource limits', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('defaults every category to a positive integer and seeds the store with those defaults', () => {
        for (const category of AGENT_RESOURCE_LIMIT_CATEGORIES) {
            const value = DEFAULT_AGENT_RESOURCE_LIMITS[category];
            expect(Number.isSafeInteger(value)).toBe(true);
            expect(value).toBeGreaterThan(0);
        }
        expect(agentResourceLimitsStore.value).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('carries the provider-boundary ceilings as configurable categories seeded from their defaults', () => {
        expect(AGENT_RESOURCE_LIMIT_CATEGORIES).toContain('maxProviderToolCalls');
        expect(AGENT_RESOURCE_LIMIT_CATEGORIES).toContain('maxModelOutputTokens');
        expect(DEFAULT_AGENT_RESOURCE_LIMITS.maxProviderToolCalls).toBe(64);
        expect(DEFAULT_AGENT_RESOURCE_LIMITS.maxModelOutputTokens).toBe(TOOL_PLAN_MAX_OUTPUT_TOKENS);

        expect(configureAgentResourceLimits({ maxProviderToolCalls: 8 })).toMatchObject({ status: 'configured' });
        expect(readAgentResourceLimits().maxProviderToolCalls).toBe(8);
    });

    it('refuses a provider loop ceiling that is not a positive integer', () => {
        expect(configureAgentResourceLimits({ maxProviderToolCalls: 0 })).toEqual({
            status: 'rejected',
            reason: 'invalid-limit',
            category: 'maxProviderToolCalls',
        });

        expect(readAgentResourceLimits()).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('writes a valid limit and leaves every other category standing', () => {
        expect(configureAgentResourceLimits({ maxCommands: 3 })).toMatchObject({ status: 'configured' });

        expect(agentResourceLimitsStore.value?.maxCommands).toBe(3);
        expect(agentResourceLimitsStore.value).toEqual({ ...DEFAULT_AGENT_RESOURCE_LIMITS, maxCommands: 3 });
    });

    it('refuses the whole update at its first invalid category and writes nothing', () => {
        expect(configureAgentResourceLimits({ maxCommands: 3, remoteTokens: 0 })).toEqual({
            status: 'rejected',
            reason: 'invalid-limit',
            category: 'remoteTokens',
        });

        expect(agentResourceLimitsStore.value).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('accepts only positive safe integers as a limit', () => {
        for (const requestChars of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(configureAgentResourceLimits({ requestChars })).toEqual({
                status: 'rejected',
                reason: 'invalid-limit',
                category: 'requestChars',
            });
        }

        expect(agentResourceLimitsStore.value).toEqual(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('arms a created run with the configured budget categories and no lifecycle or provider ceiling', () => {
        createRun('armed-limits-run');

        const armed = agentRunLifecycle.get('armed-limits-run')?.budgets;
        expect(armed?.limits).not.toHaveProperty('maxProviderToolCalls');
        expect(armed?.limits).not.toHaveProperty('maxModelOutputTokens');
        expect(armed).toEqual({
            limits: {
                maxCommands: DEFAULT_AGENT_RESOURCE_LIMITS.maxCommands,
                maxAutomationPoints: DEFAULT_AGENT_RESOURCE_LIMITS.maxAutomationPoints,
                maxRenderJobs: DEFAULT_AGENT_RESOURCE_LIMITS.maxRenderJobs,
                maxImportedAssets: DEFAULT_AGENT_RESOURCE_LIMITS.maxImportedAssets,
                maxDeletedObjects: DEFAULT_AGENT_RESOURCE_LIMITS.maxDeletedObjects,
                remoteTokens: DEFAULT_AGENT_RESOURCE_LIMITS.remoteTokens,
                localAnalysis: DEFAULT_AGENT_RESOURCE_LIMITS.localAnalysis,
                hostedTextPlanningTokens: DEFAULT_AGENT_RESOURCE_LIMITS.hostedTextPlanningTokens,
                localTextPlanningTokens: DEFAULT_AGENT_RESOURCE_LIMITS.localTextPlanningTokens,
                downloadBytes: DEFAULT_AGENT_RESOURCE_LIMITS.downloadBytes,
                storageBytes: DEFAULT_AGENT_RESOURCE_LIMITS.storageBytes,
            },
            consumed: {},
        });
    });

    it('spends command work against the configured command ceiling', () => {
        configureAgentResourceLimits({ maxCommands: 2 });
        createRun('over-ceiling-run');
        createRun('at-ceiling-run');

        expect(
            agentWorkBudget.reserveCommandWork({
                runId: 'over-ceiling-run',
                attemptId: 'batch-a:1',
                envelope: commandBatch(3),
            })
        ).toMatchObject({ status: 'hard-limit-reached', reason: 'maxCommands' });
        expect(
            agentWorkBudget.reserveCommandWork({
                runId: 'at-ceiling-run',
                attemptId: 'batch-b:1',
                envelope: commandBatch(2),
            })
        ).toMatchObject({ status: 'reserved' });
    });

    it('keeps an explicit budget envelope over the configured ceilings', () => {
        configureAgentResourceLimits({ maxCommands: 2 });
        agentRunLifecycle.create({
            runId: 'explicit-budget-run',
            request: 'Arrange this project.',
            mode: 'apply',
            createdRevision: 'revision-a',
            budgets: { limits: {}, consumed: {} },
        });

        expect(
            agentWorkBudget.reserveCommandWork({
                runId: 'explicit-budget-run',
                attemptId: 'batch-a:1',
                envelope: commandBatch(3),
            })
        ).toMatchObject({ status: 'reserved' });
    });

    it('refuses a request longer than the configured character ceiling and stores no run', () => {
        configureAgentResourceLimits({ requestChars: 10 });

        expect(createRun('oversized-run', 'x'.repeat(11))).toEqual({
            status: 'hard-limit-reached',
            reason: 'requestChars',
        });
        expect(agentRunLifecycle.get('oversized-run')).toBeNull();
        expect(createRun('exact-size-run', 'x'.repeat(10))).toEqual({ status: 'created' });
    });

    it('counts only active runs against the configured concurrency ceiling', () => {
        configureAgentResourceLimits({ concurrentRuns: 2 });
        for (const runId of ['concurrent-run-a', 'concurrent-run-b']) {
            expect(createRun(runId)).toEqual({ status: 'created' });
            agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
            agentRunLifecycle.transitionPhase({ runId, phase: 'executing' });
        }

        expect(createRun('concurrent-run-c')).toEqual({ status: 'hard-limit-reached', reason: 'concurrentRuns' });

        agentRunLifecycle.transitionPhase({ runId: 'concurrent-run-a', phase: 'paused' });
        expect(createRun('concurrent-run-c')).toEqual({ status: 'created' });

        agentRunLifecycle.transitionPhase({ runId: 'concurrent-run-c', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'concurrent-run-c', phase: 'waiting-for-approval' });
        expect(createRun('concurrent-run-d')).toEqual({ status: 'created' });
    });

    it('stops counting an active-phase run once it ages past the configured wall-clock limit', () => {
        configureAgentResourceLimits({ concurrentRuns: 1, runDurationMs: 1000 });
        agentRunLifecycle.create({
            runId: 'aging-run-a',
            request: 'Arrange this project.',
            mode: 'apply',
            createdRevision: 'revision-a',
            createdAt: 1_000,
        });
        agentRunLifecycle.transitionPhase({ runId: 'aging-run-a', phase: 'planning', transitionedAt: 1_000 });
        agentRunLifecycle.transitionPhase({ runId: 'aging-run-a', phase: 'executing', transitionedAt: 1_000 });

        expect(
            agentRunLifecycle.create({
                runId: 'aging-run-b',
                request: 'Arrange this project.',
                mode: 'apply',
                createdRevision: 'revision-a',
                createdAt: 2_000,
            })
        ).toEqual({ status: 'hard-limit-reached', reason: 'concurrentRuns' });

        expect(
            agentRunLifecycle.create({
                runId: 'aging-run-b',
                request: 'Arrange this project.',
                mode: 'apply',
                createdRevision: 'revision-a',
                createdAt: 2_001,
            })
        ).toEqual({ status: 'created' });
    });

    it('refuses a reservation made past the configured run duration and records no attempt', () => {
        configureAgentResourceLimits({ runDurationMs: 1000 });
        const createdAt = 1_700_000_000_000;
        agentRunLifecycle.create({
            runId: 'timed-run',
            request: 'Arrange this project.',
            mode: 'apply',
            createdRevision: 'revision-a',
            createdAt,
        });
        agentRunLifecycle.transitionPhase({ runId: 'timed-run', phase: 'planning', transitionedAt: createdAt });
        agentRunLifecycle.transitionPhase({ runId: 'timed-run', phase: 'executing', transitionedAt: createdAt });

        expect(
            agentRunLifecycle.reserveBudget({
                runId: 'timed-run',
                attemptId: 'at-duration-limit',
                category: 'remoteTokens',
                estimate: 1,
                provenance: 'versioned-estimate',
                reservedAt: createdAt + 1000,
            })
        ).toEqual({ status: 'reserved' });
        expect(agentRunLifecycle.get('timed-run')?.budgetAttempts).toHaveLength(1);

        expect(
            agentRunLifecycle.reserveBudget({
                runId: 'timed-run',
                attemptId: 'past-duration-limit',
                category: 'remoteTokens',
                estimate: 1,
                provenance: 'versioned-estimate',
                reservedAt: createdAt + 1001,
            })
        ).toEqual({ status: 'hard-limit-reached', reason: 'runDurationMs' });
        expect(agentRunLifecycle.get('timed-run')?.budgetAttempts).toHaveLength(1);
    });

    it('admits the reservation an approval makes after the run waited longer than its wall-clock limit', () => {
        configureAgentResourceLimits({ runDurationMs: 1000 });
        const createdAt = 1_700_000_000_000;
        agentRunLifecycle.create({
            runId: 'deliberated-run',
            request: 'Arrange this project.',
            mode: 'apply',
            createdRevision: 'revision-a',
            createdAt,
        });
        agentRunLifecycle.transitionPhase({ runId: 'deliberated-run', phase: 'planning', transitionedAt: createdAt });
        agentRunLifecycle.transitionPhase({
            runId: 'deliberated-run',
            phase: 'waiting-for-approval',
            transitionedAt: createdAt,
        });

        expect(agentRunLifecycle.get('deliberated-run')?.activeSince).toBeNull();
        expect(
            agentRunLifecycle.reserveBudget({
                runId: 'deliberated-run',
                attemptId: 'approved-after-deliberation',
                category: 'remoteTokens',
                estimate: 1,
                provenance: 'versioned-estimate',
                reservedAt: createdAt + 1000 + 60_000,
            })
        ).toEqual({ status: 'reserved' });
    });

    it('refuses the reservation an executing run makes past its current active stretch', () => {
        configureAgentResourceLimits({ runDurationMs: 1000 });
        const createdAt = 1_700_000_000_000;
        const executingSince = createdAt + 5_000;
        agentRunLifecycle.create({
            runId: 'stretched-run',
            request: 'Arrange this project.',
            mode: 'apply',
            createdRevision: 'revision-a',
            createdAt,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'stretched-run',
            phase: 'planning',
            transitionedAt: executingSince,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'stretched-run',
            phase: 'executing',
            transitionedAt: executingSince + 10,
        });

        expect(agentRunLifecycle.get('stretched-run')?.activeSince).toBe(executingSince);
        expect(
            agentRunLifecycle.reserveBudget({
                runId: 'stretched-run',
                attemptId: 'past-active-stretch',
                category: 'remoteTokens',
                estimate: 1,
                provenance: 'versioned-estimate',
                reservedAt: executingSince + 1001,
            })
        ).toEqual({ status: 'hard-limit-reached', reason: 'runDurationMs' });
    });

    it('re-anchors the active stretch when a parked run resumes into an active phase', () => {
        agentRunLifecycle.create({
            runId: 'resumed-run',
            request: 'Arrange this project.',
            mode: 'apply',
            createdRevision: 'revision-a',
            createdAt: 1_000,
        });
        agentRunLifecycle.transitionPhase({ runId: 'resumed-run', phase: 'planning', transitionedAt: 2_000 });
        agentRunLifecycle.transitionPhase({
            runId: 'resumed-run',
            phase: 'waiting-for-approval',
            transitionedAt: 3_000,
        });
        agentRunLifecycle.transitionPhase({ runId: 'resumed-run', phase: 'executing', transitionedAt: 4_000 });

        expect(agentRunLifecycle.get('resumed-run')?.activeSince).toBe(4_000);
    });

    it('names an exhausted wall-clock limit apart from an overspent budget category', () => {
        expect(describeAgentRunHardLimit('runDurationMs', 'confirmed command work')).toBe(
            'The agent run exceeded its wall-clock limit before the confirmed command work could start; submit the request again.'
        );
        expect(describeAgentRunHardLimit('maxCommands', 'confirmed command work')).toBe(
            'The confirmed command work exceeds the user budget for maxCommands.'
        );
    });
});
