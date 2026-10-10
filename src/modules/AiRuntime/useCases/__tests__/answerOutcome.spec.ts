import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { parsePromptToActions } from '../parsePromptToActions';

/**
 * AC-001 (#4381): a question ends the run in an `answer` outcome. The planner reaches it only
 * through the terminal `answer.respond` call, which the application-owned loop admits alone in its
 * turn, with real text, and with its evidence resolved against the run's own receipts.
 */

const mocks = vi.hoisted(() => ({
    getProjectContext: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: vi.fn(() => 'revision-1'),
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() => 'revision-1'),
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

const PROMPT = "What's the loudness of the master?";
const ANSWER_TEXT = 'The master integrates at -14.2 LUFS with a true peak of -1.1 dBTP.';
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
    toolCalls: [
        { id: 'caps-1', name: 'agent.capabilities', arguments: {} },
        { id: 'recipes-1', name: 'recipe.discover', arguments: { descriptors: ['warm'] } },
    ],
};

function answerTurn(argumentsValue: Record<string, unknown>) {
    return {
        status: 'complete' as const,
        toolCalls: [{ id: 'answer-1', name: 'answer.respond', arguments: argumentsValue }],
    };
}

function runScriptedLoop(turns: readonly unknown[]) {
    const requestTurn = vi.fn();
    for (const turn of turns) {
        requestTurn.mockResolvedValueOnce(turn);
    }
    return runApplicationOwnedToolLoop({
        loopId: 'loop-answer',
        terminalToolNames: TERMINAL_TOOL_NAMES,
        requestTurn,
    });
}

describe('answer.respond ends a run as an answer outcome', () => {
    let uuidCounter = 0;

    beforeEach(() => {
        vi.clearAllMocks();
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
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(readTurn)
            .mockResolvedValueOnce(answerTurn({ text: ANSWER_TEXT, evidenceCallIds: ['caps-1', 'recipes-1'] }));

        const result = await parsePromptToActions({ prompt: PROMPT, context, projectRevision: 'revision-1' });

        const receipts = result.applicationToolReceipts ?? [];
        expect(receipts.map(({ callId, status }) => ({ callId, status }))).toEqual([
            { callId: 'caps-1', status: 'success' },
            { callId: 'recipes-1', status: 'success' },
        ]);
        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.requiresConfirmation).toBe(false);
        expect(result.planningOutcome).toEqual({
            kind: 'answer',
            text: ANSWER_TEXT,
            evidence: receipts.map(({ callId, toolName, summary }) => ({ callId, toolName, summary })),
        });
        expect(result.planningOutcome?.kind === 'answer' && result.planningOutcome.evidence[0]?.toolName).toBe(
            'agent.capabilities'
        );
    });

    it('answers in the chat with no pending confirmation and completes the run', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce(readTurn)
            .mockResolvedValueOnce(answerTurn({ text: ANSWER_TEXT, evidenceCallIds: ['recipes-1'] }));

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
        const recipeReceipt = run?.plan?.applicationToolReceipts?.find((receipt) => receipt.callId === 'recipes-1');
        expect(recipeReceipt?.status).toBe('success');
        const messages = chatStore.value?.messages ?? [];
        expect(messages.map(({ role, content, error }) => ({ role, content, error }))).toEqual([
            { role: 'user', content: PROMPT, error: undefined },
            { role: 'assistant', content: ANSWER_TEXT, error: undefined },
        ]);
        expect(messages[1]?.answerEvidence).toEqual([
            { callId: 'recipes-1', toolName: 'recipe.discover', summary: recipeReceipt?.summary },
        ]);
        expect(messages[1]?.pendingActionConfirmationId).toBeUndefined();
    });

    it('refuses an answer whose text is empty once trimmed', async () => {
        const result = await runScriptedLoop([answerTurn({ text: ' \n\t ', evidenceCallIds: [] })]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider answer field text must be non-empty text of at most 4096 characters.',
        });
    });

    it('refuses an answer that cites a call id this run never made', async () => {
        const result = await runScriptedLoop([
            readTurn,
            answerTurn({ text: ANSWER_TEXT, evidenceCallIds: ['caps-1', 'measure-from-another-run'] }),
        ]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider answer cited a call id that names no successful call of this run.',
        });
    });

    it('refuses an answer that cites a call of this run that failed', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [{ id: 'bad-recipes', name: 'recipe.discover', arguments: { descriptors: [] } }],
            },
            answerTurn({ text: ANSWER_TEXT, evidenceCallIds: ['bad-recipes'] }),
        ]);

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider answer cited a call id that names no successful call of this run.',
            receipts: [{ callId: 'bad-recipes', status: 'failure' }],
        });
    });

    it('lists each cited receipt once, in the order first cited, however often the provider repeats it', async () => {
        const result = await runScriptedLoop([
            readTurn,
            answerTurn({ text: ANSWER_TEXT, evidenceCallIds: ['recipes-1', 'caps-1', 'recipes-1', 'caps-1'] }),
        ]);

        expect(result.status).toBe('complete');
        const evidence = result.status === 'complete' ? result.answer?.evidence : undefined;
        expect(evidence?.map((entry) => entry.callId)).toEqual(['recipes-1', 'caps-1']);
    });

    it('refuses a turn that answers and proposes a batch at once, so an answer never runs a batch', async () => {
        const result = await runScriptedLoop([
            {
                status: 'complete',
                toolCalls: [
                    { id: 'answer-1', name: 'answer.respond', arguments: { text: ANSWER_TEXT, evidenceCallIds: [] } },
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
            reason: 'Provider combined an answer with another terminal call.',
        });
    });

    it('lets an answer that cites nothing end the run, as a descriptive answer from context alone', async () => {
        const result = await runScriptedLoop([answerTurn({ text: ANSWER_TEXT, evidenceCallIds: [] })]);

        expect(result).toMatchObject({
            status: 'complete',
            decline: null,
            answer: { text: ANSWER_TEXT, evidence: [] },
        });
    });
});
