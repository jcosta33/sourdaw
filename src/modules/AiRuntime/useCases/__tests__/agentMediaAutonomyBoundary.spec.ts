import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas, getMidiTransformToolSchemas } from '#/modules/Command/useCases';

import { type AgentDataCategory, assertRemoteAgentDataPolicy } from '../../models/AgentDataPolicy';
import { type AgentPlanProposal, type AgentRunGrants } from '../../models/AgentRun';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { getAgentToolCatalogSchemas } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { planAgentRun } from '../planAgentRun';

const DEFERRED_LISTENING_NAME = 'agent.media.listen';

const grants: AgentRunGrants = {
    allowedOperationPrefixes: ['muteTrack'],
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

function planWith(capabilityIds: string[]) {
    return planAgentRun({
        request: 'Mute the noisy track.',
        revision: 'heads-listen',
        actions: [{ type: 'muteTrack' }],
        actionLabels: ['Mute Track 1'],
        scope: { ...scope, targetIds: [...scope.targetIds] },
        grants,
        budgets: { limits: {}, consumed: {} },
        requiresConfirmation: false,
        providerProposal: proposal(capabilityIds),
    });
}

/** Every property name any advertised schema exposes, including nested object and array shapes. */
function collectParameterNames(schema: unknown, names: Set<string>): void {
    if (typeof schema !== 'object' || schema === null) {
        return;
    }
    const record = schema as Record<string, unknown>;
    const properties = record.properties;
    if (typeof properties === 'object' && properties !== null) {
        for (const [key, child] of Object.entries(properties)) {
            names.add(key);
            collectParameterNames(child, names);
        }
    }
    collectParameterNames(record.items, names);
}

function getAdvertisedSchemas() {
    return [...getAgentToolCatalogSchemas(), ...getExecutableAppActionToolSchemas(), ...getMidiTransformToolSchemas()];
}

describe('agent media autonomy boundary (AC-044)', () => {
    beforeEach(() => {
        clearPendingActionConfirmations();
    });

    it('reports agent.media.listen as a deferred, non-callable capability in the agent.capabilities receipt', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-media-listen-capabilities',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'capabilities-1', name: 'agent.capabilities', arguments: {} }],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        const receipt = result.receipts.find((entry) => entry.callId === 'capabilities-1');
        expect(receipt?.status).toBe('success');
        expect(receipt?.data).toMatchObject({
            operations: expect.arrayContaining([
                {
                    name: DEFERRED_LISTENING_NAME,
                    kind: 'deferred-capability',
                    callable: false,
                    owner: 'AiRuntime',
                    availability: 'deferred',
                    reason: expect.stringContaining('AC-044'),
                },
            ]),
        });
    });

    it('returns the deferred listening entry from catalog discovery in the capability category', () => {
        const catalog = getAgentToolCatalogEntries({
            category: 'capability',
            names: [DEFERRED_LISTENING_NAME],
        });

        expect(catalog).toMatchObject({
            category: 'capability',
            page: { total: 1 },
            truncated: false,
        });
        expect(catalog.items).toEqual([
            {
                name: DEFERRED_LISTENING_NAME,
                kind: 'deferred-capability',
                callable: false,
                owner: 'AiRuntime',
                availability: 'deferred',
                reason: expect.stringContaining('AC-044'),
            },
        ]);
    });

    it('rejects a provider turn that calls agent.media.listen before any receipt or mutation', async () => {
        const requestTurn = vi.fn().mockResolvedValue({
            status: 'complete',
            toolCalls: [{ id: 'listen-1', name: DEFERRED_LISTENING_NAME, arguments: { trackId: 'track-1' } }],
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-media-listen-call',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
            receipts: [],
            turns: 1,
        });
        expect(requestTurn).toHaveBeenCalledTimes(1);
        expect(pendingActionConfirmationStore.value?.confirmations ?? []).toEqual([]);
    });

    it('advertises no schema that accepts an audio payload', () => {
        const schemas = getAdvertisedSchemas();
        const names = schemas.map((schema) => schema.function.name);

        expect(names.filter((name) => /listen|audio|bounce/iu.test(name))).toEqual([]);
        // `importStemSet` is the ordinary user-selected file import, not an agent listening route: it
        // names an application-owned selection and per-stem identities, never sample data.
        expect(names.filter((name) => /stem/iu.test(name))).toEqual(['importStemSet']);

        const parameterNames = new Set<string>();
        for (const schema of schemas) {
            collectParameterNames(schema.function.parameters, parameterNames);
        }
        expect([...parameterNames].filter((name) => /pcm|sample|byte|base64|buffer|waveform/iu.test(name))).toEqual([]);
        expect([...parameterNames].filter((name) => /audio|stem/iu.test(name))).toEqual(['stems', 'stemId']);

        const stemProperties = schemas.find((schema) => schema.function.name === 'importStemSet')?.function.parameters
            .properties;
        if (stemProperties === undefined || !('stems' in stemProperties)) {
            throw new TypeError('Expected the advertised importStemSet schema to declare its stems parameter.');
        }
        expect(stemProperties.stems).toMatchObject({
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: { stemId: { type: 'string' }, role: { type: 'string', enum: expect.any(Array) } },
                required: ['stemId', 'role'],
            },
        });
    });

    it('refuses remote transmission of render, stem, reference and bounce listening audio', () => {
        const blocked: AgentDataCategory[] = ['render', 'stem', 'reference-audio', 'bounce-listening-audio'];

        for (const category of blocked) {
            expect(() => {
                assertRemoteAgentDataPolicy([category]);
            }).toThrow(`Remote AI transmission blocked for: ${category}`);
        }
        expect(() => {
            assertRemoteAgentDataPolicy(['prompt-text', 'midi']);
        }).not.toThrow();
    });

    it('reports the audio-listening policy as deferred and refuses a plan that requires it', () => {
        const withoutListening = planWith(['muteTrack']);
        if (withoutListening.status !== 'planned') {
            throw new Error('Expected the control plan without a listening capability to be planned.');
        }
        expect(withoutListening.plan.capabilities).toContainEqual({
            id: 'audio-listening-policy',
            source: 'data-policy',
            prerequisite: 'Agent audio listening is a deferred capability and cannot be granted for this run.',
            status: 'available',
        });

        expect(planWith(['muteTrack', 'audio-listening'])).toEqual({
            status: 'rejected',
            reason: 'A validated capability, budget, asset, or data-policy prerequisite is unavailable.',
        });
        expect(planWith(['muteTrack', 'media-listening'])).toEqual({
            status: 'rejected',
            reason: 'A validated capability, budget, asset, or data-policy prerequisite is unavailable.',
        });
    });
});
