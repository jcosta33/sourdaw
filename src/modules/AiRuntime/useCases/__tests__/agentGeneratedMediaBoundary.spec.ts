import { afterEach, describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas, getMidiTransformToolSchemas } from '#/modules/Command/useCases';

import { type AgentPlanProposal, type AgentRunGrants } from '../../models/AgentRun';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getAgentToolCatalogSchemas } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { planAgentRun } from '../planAgentRun';

const DEFERRED_GENERATION_NAME = 'agent.media.generate';

const grantedMediaGrants: AgentRunGrants = {
    allowedOperationPrefixes: ['muteTrack'],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: true,
    remoteGeneration: true,
    autoCommit: false,
};

const scope = { targetIds: ['track-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };

function proposal(capabilityIds: string[]): AgentPlanProposal {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Mute the noisy track.',
        constraints: [],
        scope: { ...scope, targetIds: [...scope.targetIds] },
        capabilityIds,
        assetIds: [],
        alternatives: [],
        validationStrategy: [],
        stoppingConditions: [],
    };
}

function planWith(capabilityIds: string[], grants: AgentRunGrants) {
    return planAgentRun({
        request: 'Mute the noisy track.',
        revision: 'heads-generate',
        actions: [{ type: 'muteTrack' }],
        actionLabels: ['Mute Track 1'],
        scope: { ...scope, targetIds: [...scope.targetIds] },
        grants,
        budgets: { limits: {}, consumed: {} },
        requiresConfirmation: false,
        providerProposal: proposal(capabilityIds),
    });
}

const UNAVAILABLE_PREREQUISITE = {
    status: 'rejected',
    reason: 'A validated capability, budget, asset, or data-policy prerequisite is unavailable.',
};

describe('agent generated media boundary (AC-047)', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('reports agent.media.generate as deferred in both the capabilities receipt and catalog discovery', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-media-generate-capabilities',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'capabilities-1', name: 'agent.capabilities', arguments: {} }],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        const deferredEntry = {
            name: DEFERRED_GENERATION_NAME,
            kind: 'deferred-capability',
            callable: false,
            owner: 'AiRuntime',
            availability: 'deferred',
            reason: expect.stringContaining('AC-047'),
        };
        expect(result.receipts.find((entry) => entry.callId === 'capabilities-1')?.data).toMatchObject({
            operations: expect.arrayContaining([deferredEntry]),
        });
        expect(getAgentToolCatalogEntries({ category: 'capability', names: [DEFERRED_GENERATION_NAME] }).items).toEqual(
            [deferredEntry]
        );
    });

    it('rejects a provider turn that calls agent.media.generate', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-media-generate-call',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    { id: 'generate-1', name: DEFERRED_GENERATION_NAME, arguments: { prompt: 'make a drum loop' } },
                ],
            }),
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
            receipts: [],
            turns: 1,
        });
    });

    it('records neither the audio-upload nor the remote-generation grant however a run is created or planned', () => {
        agentRunLifecycle.create({
            runId: 'run-granted-media',
            request: 'Generate a chorus stem.',
            mode: 'apply',
            createdRevision: 'heads-generate',
            grants: grantedMediaGrants,
            createdAt: 1,
        });

        expect(agentRunLifecycle.get('run-granted-media')?.grants).toMatchObject({
            audioUpload: false,
            remoteGeneration: false,
            allowedOperationPrefixes: ['muteTrack'],
        });

        agentRunLifecycle.recordPlan({
            runId: 'run-granted-media',
            summary: 'Mute Track 1',
            commandIds: ['command-1'],
            serializedBatchIdentity: 'batch-1',
            revision: 'heads-generate',
            scope: { ...scope, targetIds: [...scope.targetIds] },
            grants: grantedMediaGrants,
            budgets: { limits: {}, consumed: {} },
            recordedAt: 2,
        });

        expect(agentRunLifecycle.get('run-granted-media')?.grants).toMatchObject({
            audioUpload: false,
            remoteGeneration: false,
        });
    });

    it('refuses a plan that requires remote generation or generated media', () => {
        const ungranted: AgentRunGrants = { ...grantedMediaGrants, audioUpload: false, remoteGeneration: false };

        expect(planWith(['muteTrack', 'remote-generation'], ungranted)).toEqual(UNAVAILABLE_PREREQUISITE);
        expect(planWith(['muteTrack', 'generated-media'], ungranted)).toEqual(UNAVAILABLE_PREREQUISITE);
        // A run cannot hold the remote-generation grant, so the generated-media policy stays
        // unavailable even when the caller proposes the grant alongside the capability.
        expect(planWith(['muteTrack', 'generated-media'], grantedMediaGrants)).toEqual(UNAVAILABLE_PREREQUISITE);

        const planned = planWith(['muteTrack'], ungranted);
        if (planned.status !== 'planned') {
            throw new Error('Expected the control plan without a media capability to be planned.');
        }
        expect(planned.plan.capabilities).toContainEqual({
            id: 'generated-media-policy',
            source: 'data-policy',
            prerequisite: 'Agent generated media is a deferred capability and cannot be granted for this run.',
            status: 'available',
        });
    });

    it('advertises no tool that generates media, and keeps the render request a section-id proposal', () => {
        const schemas = [
            ...getAgentToolCatalogSchemas(),
            ...getExecutableAppActionToolSchemas(),
            ...getMidiTransformToolSchemas(),
        ];
        const names = schemas.map((schema) => schema.function.name);

        expect(names.filter((name) => /generat|synth|sampl/iu.test(name))).toEqual([]);
        expect(names.filter((name) => /render/iu.test(name)).sort()).toEqual([
            'render.request',
            'renderProjectSections',
        ]);

        // `render.request` is proposal-only: it names arrangement sections the application already
        // owns and carries no media of its own, in or out.
        const renderRequest = schemas.find((schema) => schema.function.name === 'render.request');
        expect(renderRequest?.function.parameters).toMatchObject({
            type: 'object',
            properties: {
                sectionIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    items: { type: 'string', minLength: 1, maxLength: 256 },
                },
            },
            required: ['sectionIds'],
            additionalProperties: false,
        });
        expect(Object.keys(renderRequest?.function.parameters.properties ?? {})).toEqual(['sectionIds']);
        const renderCommand = schemas.find((schema) => schema.function.name === 'renderProjectSections');
        expect(Object.keys(renderCommand?.function.parameters.properties ?? {})).toEqual(['sectionIds']);
    });
});
