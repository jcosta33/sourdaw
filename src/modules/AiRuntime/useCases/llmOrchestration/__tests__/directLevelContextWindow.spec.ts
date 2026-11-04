import { describe, expect, it, vi } from 'vitest';

import { createCreativeInterpretationToolSchema } from '../../../models/CreativeInterpretation';
import {
    LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
} from '../../../models/LocalPlanningBudget';
import { THREAD_CONTEXT_MAX_BYTES } from '../../../models/ThreadContext';
import { getWebLlmContextWindowSize } from '../../../repositories/webLlm/getWebLlmContextWindowSize';
import { buildPlanningSystemPrompt } from '../../../transformers/buildPlanningSystemPrompt';
import { estimateConservativePromptTokens } from '../../../transformers/estimateConservativePromptTokens';
import { createPlanningProject, fixtureUuid } from '../../__tests__/planningProjectFixture';
import { createFullThreadContext } from '../../__tests__/threadContextFixture';
import { buildAgentContext } from '../../buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../../createPlanningInterpretationToolSchema';
import { getPlanningProviderToolSchemas } from '../../getPlanningProviderToolSchemas';
import { getProjectContext } from '../../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../../prepareCreativeInterpretationCatalog';
import { projectPlanningProviderToolSchemas } from '../../projectPlanningProviderToolSchemas';
import { generateToolPlanningOutcome, WEBLLM_TOOL_BUDGET } from '../inference';

const mocks = vi.hoisted(() => ({ completion: vi.fn(), toolCalls: vi.fn() }));
vi.mock('../backendResolution/getBackendChain', () => ({ getBackendChain: () => ['webllm'] }));
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.completion,
}));
vi.mock('../../../repositories/webLlm/toolCalling', () => ({ generateWebLlmToolCalls: mocks.toolCalls }));

describe('direct level context window', () => {
    it('fits actual VCA and metronome context with a full thread and 37 advertised tools', async () => {
        const prompt = 'make the chorus wider and tame the harshness on the lead vocal';
        const base = createPlanningProject(getProjectContext(), 5);
        const groupId = `vca-${fixtureUuid('direct-level-window')}`;
        const context = {
            ...base,
            metronomeVolume: 0.5,
            vcaGroups: [{ id: groupId, name: 'Drums VCA', gain: 0.75, muted: false, trackIds: [base.tracks[0]!.id] }],
        };
        const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' });
        const advertised = projectPlanningProviderToolSchemas(
            [...getPlanningProviderToolSchemas(), createCreativeInterpretationToolSchema(catalog)],
            'planning'
        );
        const system = buildPlanningSystemPrompt(undefined, 'planning');
        const receipt = {
            callId: 'call-1',
            toolName: 'project.query',
            status: 'success',
            data: { trackId: 'track-3', name: 'Lead Vocal', gainDb: -6.2, devices: ['builtin-eq'] },
        };
        const summary =
            `Application-owned tool receipts from turn 1 follow as JSON.\n${JSON.stringify({ receipts: Array.from({ length: 64 }, () => receipt) })}`.slice(
                0,
                8192
            );
        const built = buildAgentContext({
            fixedPolicy: system,
            prompt,
            context,
            projectRevision: 'revision-1',
            receipts: [{ id: 'application-tool-loop', summary }],
            capabilitySchemas: advertised.map((tool) => ({ name: tool.function.name, schemaVersion: 1 })),
            thread: createFullThreadContext(),
        });
        const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' });
        const tools = projectPlanningProviderToolSchemas(
            [
                ...getPlanningProviderToolSchemas(),
                createPlanningInterpretationToolSchema({ creative: catalog, answer, binding: built.planningBinding }),
            ],
            'planning'
        );
        const actual = await vi.importActual<typeof import('../../../repositories/webLlm/toolCalling')>(
            '../../../repositories/webLlm/toolCalling'
        );
        mocks.toolCalls.mockImplementation(actual.generateWebLlmToolCalls);
        mocks.completion.mockResolvedValue('[]');
        const outcome = await generateToolPlanningOutcome(
            system,
            built.message,
            tools,
            undefined,
            prompt,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            built.localMessage
        );
        expect(outcome).toMatchObject({ status: 'complete' });
        expect(mocks.toolCalls.mock.calls[0]?.[2]).toHaveLength(WEBLLM_TOOL_BUDGET);
        const [systemText, userText] = mocks.completion.mock.calls[0] ?? [];
        if (typeof systemText !== 'string' || typeof userText !== 'string') {
            throw new TypeError('Expected the local request to reach the engine.');
        }
        expect(userText).toBe(built.localMessage);
        expect(userText).toContain(groupId);
        expect(userText).toContain('metronomeVolumeDb');
        const section = `\n\nthread_context:\n${userText.split('\n\nthread_context:\n')[1]?.split('\n\n')[0] ?? ''}`;
        const cost =
            estimateConservativePromptTokens(systemText) +
            estimateConservativePromptTokens(userText.replace(section, '')) +
            LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS +
            THREAD_CONTEXT_MAX_BYTES.local +
            LOCAL_PLANNING_REPLY_RESERVE_TOKENS;
        expect(cost).toBeLessThanOrEqual(getWebLlmContextWindowSize());
    });
});
