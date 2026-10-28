import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectStore, defaultProjectStoreState } from '#/modules/Project/stores';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type ProjectContext } from '../../models/ProjectContext';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { orchestratePromptChatRequest } from '../agentRequestOrchestration/orchestratePromptChatRequest';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { answerIntakeFromTools, structuralAnswerArguments } from './answerWireFixture';
import { admitAnswerInterpretation } from '../admitAnswerInterpretation';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { parsePromptToActions } from '../parsePromptToActions';

/**
 * AC-001 (#4381): a question ends the run in an `answer` outcome. The planner reaches it only
 * through the terminal `answer.respond` call, which the application-owned loop admits alone in its
 * turn, with app-composed facts, and with its evidence resolved against the run's own receipts.
 */

const mocks = vi.hoisted(() => ({
    getProjectContext: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: vi.fn(() => JSON.stringify({ documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] })),
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() =>
        JSON.stringify({ documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] })
    ),
}));

vi.mock('../getProjectContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../getProjectContext')>()),
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: () => 'fixture-model' }));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...original,
        tryPresetMatch: vi.fn(original.tryPresetMatch),
        tryParameterizedPath: vi.fn(original.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(original.tryCompoundFastPath),
    };
});

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

const PROMPT = 'Describe the project structure.';
const ANSWER_TEXT =
    'The project has 0 audio/MIDI track(s), 0 bus(es), and 0 folder(s). Master output is separate. Tempo is 120 BPM in 4/4.';
const RUN_ID = 'agent-run-00000000-0000-0000-0000-000000000001';
const TERMINAL_TOOL_NAMES = new Set(['command.batch.propose', 'command.batch.decline', 'answer.respond']);

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const readTurn = {
    status: 'complete' as const,
    toolCalls: [{ id: 'query', name: 'project.query', arguments: { type: 'project-summary' } }],
};
function scriptStructuralAnswer() {
    vi.mocked(generateToolPlanningOutcome)
        .mockImplementationOnce(async (_system, _message, tools) => ({
            status: 'complete',
            toolCalls: [answerIntakeFromTools(tools)],
        }))
        .mockResolvedValueOnce(readTurn)
        .mockResolvedValueOnce(
            answerTurn({
                intakeCallId: 'intake',
                statements: [
                    { kind: 'project-fact', fact: 'summary' },
                    { kind: 'query-page', callId: 'query' },
                ],
            })
        );
}

function answerTurn(argumentsValue: Record<string, unknown>) {
    return {
        status: 'complete' as const,
        toolCalls: [{ id: 'answer-1', name: 'answer.respond', arguments: argumentsValue }],
    };
}

function runScriptedLoop(turns: readonly unknown[]) {
    const catalog = prepareAnswerInterpretationCatalog({ prompt: PROMPT, context, projectRevision: 'revision-1' });
    const intake = {
        id: 'intake',
        name: 'selectAnswerInterpretation',
        arguments: {
            catalogId: catalog.catalogId,
            kind: 'project-facts',
            topicIds: [],
            scopeCandidateIds: [],
            rangeCandidateId: null,
            uncertainty: 'none',
        },
    };
    const requestTurn = vi.fn().mockResolvedValueOnce({ status: 'complete', toolCalls: [intake] });
    for (const turn of turns) {
        requestTurn.mockResolvedValueOnce(turn);
    }
    return runApplicationOwnedToolLoop({
        loopId: 'loop-answer',
        terminalToolNames: TERMINAL_TOOL_NAMES,
        requestTurn,
        answerInterpretation: {
            admit: (call) => admitAnswerInterpretation({ catalog, call, projectRevision: 'revision-1' }),
        },
    });
}

describe('answer.respond ends a run as an answer outcome', () => {
    let uuidCounter = 0;

    beforeEach(() => {
        vi.clearAllMocks();
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            initialized: true,
            loading: false,
        });
        uuidCounter = 0;
        vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
            uuidCounter += 1;
            return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
        });
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        mocks.getProjectContext.mockReturnValue(context);
        clearPendingActionConfirmations();
        clearChatMessages();
        agentRunLifecycle.clear();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('plans an answer carrying its text and the evidence resolved from this run, with no actions', async () => {
        scriptStructuralAnswer();

        const result = await parsePromptToActions({ prompt: PROMPT, context, projectRevision: 'revision-1' });

        const receipts = result.applicationToolReceipts ?? [];
        expect(receipts.map(({ callId, status }) => ({ callId, status }))).toEqual([
            { callId: 'intake', status: 'success' },
            { callId: 'query', status: 'success' },
        ]);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.requiresConfirmation).toBe(false);
        expect(result.planningOutcome).toEqual({
            kind: 'answer',
            text: expect.stringContaining(ANSWER_TEXT),
            evidence: receipts.map(({ callId, toolName, summary }) => ({ callId, toolName, summary })),
        });
        expect(result.planningOutcome?.kind === 'answer' && result.planningOutcome.evidence[0]?.toolName).toBe(
            'selectAnswerInterpretation'
        );
    });

    it('answers in the chat with no pending confirmation and completes the run', async () => {
        scriptStructuralAnswer();

        await orchestratePromptChatRequest({
            userText: PROMPT,
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        const run = agentRunLifecycle.get(RUN_ID);
        expect(run?.phase).toBe('completed');
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
        const recipeReceipt = run?.plan?.applicationToolReceipts?.find((receipt) => receipt.callId === 'query');
        expect(recipeReceipt?.status).toBe('success');
        const messages = chatStore.value?.messages ?? [];
        expect(messages.map(({ role, content, error }) => ({ role, content, error }))).toEqual([
            { role: 'user', content: PROMPT, error: undefined },
            { role: 'assistant', content: expect.stringContaining(ANSWER_TEXT), error: undefined },
        ]);
        expect(messages[1]?.answerEvidence).toEqual([
            expect.objectContaining({ callId: 'intake', toolName: 'selectAnswerInterpretation' }),
            { callId: 'query', toolName: 'project.query', summary: recipeReceipt?.summary },
        ]);
        expect(messages[1]?.pendingActionConfirmationId).toBeUndefined();
    });

    it('refuses an answer whose text is empty once trimmed', async () => {
        const result = await runScriptedLoop([answerTurn({ text: ' \n\t ', evidenceCallIds: [] })]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider answer must be a bounded closed factual document.',
        });
    });

    it('refuses an answer that cites a call id this run never made', async () => {
        const result = await runScriptedLoop([
            readTurn,
            answerTurn({
                intakeCallId: 'intake',
                statements: [{ kind: 'query-page', callId: 'measure-from-another-run' }],
            }),
        ]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Answer references evidence outside its frozen interpretation or successful bounded reads.',
        });
    });

    it('refuses an answer that cites a call of this run that failed', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [{ id: 'bad-recipes', name: 'recipe.discover', arguments: { descriptors: [] } }],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'bad-recipes' }] }),
        ]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Answer references evidence outside its frozen interpretation or successful bounded reads.',
            receipts: [
                expect.objectContaining({ callId: 'intake' }),
                expect.objectContaining({ callId: 'bad-recipes', status: 'failure' }),
            ],
        });
    });

    it('lists each cited receipt once, in the order first cited, however often the provider repeats it', async () => {
        const result = await runScriptedLoop([
            readTurn,
            answerTurn({
                intakeCallId: 'intake',
                statements: [
                    { kind: 'query-page', callId: 'query' },
                    { kind: 'query-page', callId: 'query' },
                ],
            }),
        ]);

        expect(result.status).toBe('complete');
        const evidence = result.status === 'complete' ? result.answer?.evidence : undefined;
        expect(evidence?.map((entry) => entry.callId)).toEqual(['intake', 'query']);
    });

    it('refuses a turn that answers and proposes a batch at once, so an answer never runs a batch', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    { id: 'answer-1', name: 'answer.respond', arguments: structuralAnswerArguments },
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                    },
                ],
            },
        ]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Answer interpretation cannot authorize a mutation, preview or preparation.',
        });
    });

    it('lets an answer that cites nothing end the run, as a descriptive answer from context alone', async () => {
        const result = await runScriptedLoop([answerTurn(structuralAnswerArguments)]);

        expect(result).toMatchObject({
            status: 'complete',
            decline: null,
            answer: { text: ANSWER_TEXT, evidence: [expect.objectContaining({ callId: 'intake' })] },
        });
    });
});
