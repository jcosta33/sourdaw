import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { projectStore, defaultProjectStoreState } from '#/modules/Project/stores';
import { querySemanticProject } from '#/modules/Project/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type ProjectContext } from '../../models/ProjectContext';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { admitAnswerInterpretation } from '../admitAnswerInterpretation';
import { orchestratePromptChatRequest } from '../agentRequestOrchestration/orchestratePromptChatRequest';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';

import { answerIntakeFromTools, structuralAnswerArguments } from './answerWireFixture';

registerDeviceEnginePorts();

/**
 * AC-001 (#4381): a question ends the run in an `answer` outcome. The planner reaches it only
 * through the terminal `answer.respond` call, which the application-owned loop admits alone in its
 * turn, with app-composed facts, and with its evidence resolved against the run's own receipts.
 */

const mocks = vi.hoisted(() => ({
    getProjectContext: vi.fn(),
}));

// The project never moves here, so every revision reader agrees on one fixed revision: the
// save-insensitive question compares against it too, rather than against the live document the
// fixed revision does not describe.
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const revision = JSON.stringify({ documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] });
    return {
        ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
        captureProjectRevision: vi.fn(() => revision),
        settlePendingProjectWritesAndCaptureRevision: vi.fn(() => revision),
        projectRevisionMatchesLiveIgnoringSaveWrites: vi.fn((expected: string) => expected === revision),
    };
});

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

function runScriptedLoop(
    turns: readonly unknown[],
    beforeIntake: readonly unknown[] = [],
    revision = captureProjectRevision(),
    limits?: { maxReceiptBytesPerCall: number }
) {
    const catalog = prepareAnswerInterpretationCatalog({ prompt: PROMPT, context, projectRevision: revision });
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
    const requestTurn = vi.fn();
    for (const turn of beforeIntake) requestTurn.mockResolvedValueOnce(turn);
    requestTurn.mockResolvedValueOnce({ status: 'complete', toolCalls: [intake] });
    for (const turn of turns) {
        requestTurn.mockResolvedValueOnce(turn);
    }
    return runApplicationOwnedToolLoop({
        loopId: 'loop-answer',
        terminalToolNames: TERMINAL_TOOL_NAMES,
        requestTurn,
        limits,
        answerInterpretation: {
            admit: (call) => admitAnswerInterpretation({ catalog, call, projectRevision: revision }),
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

        const result = await parsePromptToActions({
            prompt: PROMPT,
            context,
            projectRevision: JSON.stringify({ documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] }),
        });

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
            'selectCreativeInterpretation'
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
            expect.objectContaining({ callId: 'intake', toolName: 'selectCreativeInterpretation' }),
            { callId: 'query', toolName: 'project.query', summary: recipeReceipt?.summary },
        ]);
        expect(messages[1]?.pendingActionConfirmationId).toBeUndefined();
    });

    it('preserves the unfiltered query sentence and cites its actual receipt', async () => {
        const result = await runScriptedLoop([
            readTurn,
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') throw new Error(result.reason);
        expect(result.answer?.text).toBe(
            'The “project-summary” query returned 1 item(s) on this page out of 1 matching item(s).'
        );
        expect(result.answer?.evidence.map((entry) => entry.callId)).toEqual(['intake', 'query']);
    });

    it('refuses a pre-intake query even when a later query succeeds', async () => {
        const result = await runScriptedLoop(
            [
                { ...readTurn, toolCalls: [{ ...readTurn.toolCalls[0]!, id: 'later' }] },
                answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
            ],
            [readTurn]
        );
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Answer references evidence outside its frozen interpretation or successful bounded reads.',
        });
    });

    it('refuses a query at a different frozen revision', async () => {
        const revision = JSON.stringify({ documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] });
        const result = await runScriptedLoop(
            [readTurn, answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] })],
            [],
            revision
        );
        expect(result.status).toBe('rejected');
    });

    it('refuses a bounded receipt that truncates the original revision', async () => {
        const revision = JSON.stringify({
            documentIdentityEpoch: 1,
            mutationEpoch: 1,
            documents: [{ docId: 'x'.repeat(2200), heads: [] }],
        });
        vi.mocked(captureProjectRevision).mockReturnValue(revision);
        const result = await runScriptedLoop([
            readTurn,
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('rejected');
        vi.mocked(captureProjectRevision).mockReturnValue(
            JSON.stringify({ documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] })
        );
    });

    it('names the retained baseline of a diff query', async () => {
        const baseline = querySemanticProject({ type: 'object' }).revisionToken;
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    { id: 'query', name: 'project.query', arguments: { type: 'diff', sinceRevision: baseline } },
                ],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') throw new Error(result.reason);
        expect(result.answer?.text).toContain(`sinceRevision: “${baseline}”`);
    });

    it('refuses a failed project query as evidence', async () => {
        const result = await runScriptedLoop([
            { status: 'complete', toolCalls: [{ id: 'query', name: 'project.query', arguments: { type: 'diff' } }] },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result).toMatchObject({
            status: 'rejected',
            receipts: expect.arrayContaining([expect.objectContaining({ callId: 'query', status: 'failure' })]),
        });
    });

    it('refuses a diff whose baseline is outside the retained window', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    {
                        id: 'query',
                        name: 'project.query',
                        arguments: { type: 'diff', sinceRevision: 'unknown-baseline' },
                    },
                ],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('rejected');
    });

    it('refuses a project query whose receipt exceeds its per-call budget', async () => {
        const tracks = Array.from({ length: 20 }, (_, index) =>
            createTrack({ id: `track-${index}`, name: `Track ${index}`, kind: 'audio' })
        );
        setTrackStoreState({ ...structuredClone(defaultTrackState), tracks });
        try {
            const result = await runScriptedLoop(
                [
                    {
                        status: 'complete',
                        toolCalls: [
                            { id: 'query', name: 'project.query', arguments: { type: 'object', page: { limit: 50 } } },
                        ],
                    },
                    answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
                ],
                [],
                captureProjectRevision(),
                { maxReceiptBytesPerCall: 2048 }
            );
            expect(result.status).toBe('rejected');
            expect(result.receipts.find((receipt) => receipt.callId === 'query')?.status).toBe('failure');
        } finally {
            setTrackStoreState(structuredClone(defaultTrackState));
        }
    });

    it('reports the owner-filtered subset of real project objects', async () => {
        const matching = createTrack({ id: 'track-a', name: 'Lead *One*', kind: 'audio' });
        const other = createTrack({ id: 'track-b', name: 'Other', kind: 'audio' });
        setTrackStoreState({ ...structuredClone(defaultTrackState), tracks: [matching, other] });
        try {
            const result = await runScriptedLoop([
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'query',
                            name: 'project.query',
                            arguments: {
                                type: 'object',
                                filters: { exactName: 'Lead *One*', kind: 'audio', muted: false },
                                page: { limit: 1 },
                            },
                        },
                    ],
                },
                answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
            ]);
            expect(result.status).toBe('complete');
            if (result.status !== 'complete') throw new Error(result.reason);
            expect(result.answer?.text).toContain('1 item(s) on this page out of 1 matching item(s)');
            expect(result.answer?.text).toContain('Lead \\*One\\*');
            expect(result.answer?.text).toContain('muted: false');
            expect(result.receipts.find((receipt) => receipt.callId === 'query')?.data).toMatchObject({
                items: [expect.objectContaining({ id: 'track-a' })],
                page: { total: 1 },
            });
        } finally {
            setTrackStoreState(structuredClone(defaultTrackState));
        }
    });

    it('names every supplied filter and page in the query scope', async () => {
        const filters = { exactName: 'A "quoted" name', selected: false, startBeat: 0, endBeat: 3.14159, muted: true };
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    { id: 'query', name: 'project.query', arguments: { type: 'object', filters, page: { limit: 2 } } },
                ],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') throw new Error(result.reason);
        expect(result.answer?.text).toContain('exactName');
        expect(result.answer?.text).toContain('selected: false');
        expect(result.answer?.text).toContain('startBeat: 0');
        expect(result.answer?.text).toContain('endBeat: 3.14159');
        expect(result.answer?.text).toContain('muted: true');
        expect(result.answer?.text).toContain('limit: 2');
    });

    it('retains all query filter keys without dropping false or zero', async () => {
        const filters = {
            stableId: 'id',
            exactName: 'name',
            fuzzyName: 'fuzzy',
            kind: 'audio',
            tag: 'tag',
            role: 'role',
            parentId: 'parent',
            startBeat: 0,
            endBeat: 2.123456,
            sectionId: 'section',
            selected: false,
            locked: false,
            muted: false,
            soloed: false,
            deviceType: 'device',
            deviceCategory: 'category',
            routeFromId: 'from',
            routeToId: 'to',
            hasAutomation: false,
            contentType: 'audio',
            assetType: 'asset',
            minInferredConfidence: 0,
        };
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [{ id: 'query', name: 'project.query', arguments: { type: 'object', filters } }],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') throw new Error(result.reason);
        for (const [key, value] of Object.entries(filters)) {
            expect(result.answer?.text).toContain(
                `${key}: ${typeof value === 'string' ? `“${value}”` : String(value)}`
            );
        }
    });

    it('limits an answer whose faithful query scope exceeds the composed bound', async () => {
        const value = '*'.repeat(256);
        const filters = {
            stableId: value,
            exactName: value,
            fuzzyName: value,
            kind: value,
            tag: value,
            role: value,
            parentId: value,
            sectionId: value,
            deviceType: value,
            deviceCategory: value,
            routeFromId: value,
            routeToId: value,
            assetType: value,
        };
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [{ id: 'query', name: 'project.query', arguments: { type: 'object', filters } }],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result).toMatchObject({
            status: 'complete',
            answer: { text: 'This answer is limited to the available bounded evidence.' },
        });
    });

    it('refuses a summary query whose requested filters are ignored by Project', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    {
                        id: 'query',
                        name: 'project.query',
                        arguments: { type: 'project-summary', filters: { muted: false } },
                    },
                ],
            },
            answerTurn({ intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] }),
        ]);
        expect(result.status).toBe('rejected');
    });

    it('refuses two answers by the answer-alone rule', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    { id: 'answer-1', name: 'answer.respond', arguments: structuralAnswerArguments },
                    { id: 'answer-2', name: 'answer.respond', arguments: structuralAnswerArguments },
                ],
            },
        ]);
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider combined an answer with another terminal call.',
        });
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
