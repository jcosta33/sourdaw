import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../../models/AgentResourceLimits';
import { type ApplicationToolReceipt } from '../../../models/ApplicationOwnedTool';
import { agentResourceLimitsStore } from '../../../stores/agentResourceLimitsStore';
import { chatStore, clearChatMessages } from '../../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { orchestratePromptChatRequest } from '../orchestratePromptChatRequest';

const mocks = vi.hoisted(() => ({
    planPromptActions: vi.fn(),
    persistPromptActionConfirmation: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureActiveBranchReference: vi.fn(),
    captureProjectMutationAuthorization: vi.fn(() => () => true),
    captureDurableDocumentWitness: vi.fn(),
    captureProjectIdentity: vi.fn(() => 'project-identity'),
    captureProjectRevision: vi.fn(() => 'revision-1'),
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() => 'revision-1'),
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    compactProject: vi.fn(),
    createCrdtDoc: vi.fn(),
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    loadCrdtProject: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    beginBranchSession: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    projectCrdtToStores: vi.fn(),
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn(() => true),
    removeCrdtDoc: vi.fn(),
    projectBranchSession: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
    resetCrdtProject: vi.fn(),
    endBranchSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: vi.fn(),
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('../../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: () => 'fixture-model' }));
vi.mock('../../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../persistPromptActionConfirmation', () => ({
    persistPromptActionConfirmation: mocks.persistPromptActionConfirmation,
}));

const RUN_ID = 'agent-run-00000000-0000-0000-0000-000000000001';
const PROMPT = 'How loud is the drum bus?';
const ANSWER_TEXT = 'The drum bus peaks at -3.1 dBFS.';

function receipt(callId: string, toolName: string, summary: string): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId,
        toolName,
        turn: 1,
        status: 'success',
        revision: 'revision-1',
        data: null,
        summary,
        warnings: [],
        error: null,
    };
}

const RECEIPTS = [
    receipt('call-1', 'analysis.measure', 'Peak -3.1 dBFS on the drum bus.'),
    receipt('call-2', 'project.query', 'Read the drum bus.'),
];

function planAnswer(): void {
    mocks.planPromptActions.mockResolvedValue({
        context: { tracks: [] },
        result: {
            actions: [],
            rawText: PROMPT,
            requiresConfirmation: false,
            applicationToolReceipts: RECEIPTS,
            planningOutcome: {
                kind: 'answer',
                text: ANSWER_TEXT,
                evidence: RECEIPTS.map(({ callId, toolName, summary }) => ({ callId, toolName, summary })),
            },
        },
        projectRevision: 'revision-1',
    });
}

async function submitInChat(): Promise<void> {
    await orchestratePromptChatRequest({
        userText: PROMPT,
        requestedRoute: 'auto',
        backend: 'webllm',
        interactionMode: 'apply',
        options: undefined,
    });
}

describe('answer outcome in the agent chat', () => {
    let uuidCounter = 0;

    beforeEach(() => {
        vi.clearAllMocks();
        uuidCounter = 0;
        clearPendingActionConfirmations();
        clearChatMessages();
        agentRunLifecycle.clear();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
        vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
            uuidCounter += 1;
            return `00000000-0000-0000-0000-00000000000${String(uuidCounter)}`;
        });
        planAnswer();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('replies with an ordinary assistant message that carries no error and lists its evidence', async () => {
        await submitInChat();

        const messages = chatStore.value?.messages ?? [];
        expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
        const reply = messages[1];
        expect(reply).toMatchObject({
            role: 'assistant',
            content: ANSWER_TEXT,
            answerEvidence: [
                { callId: 'call-1', toolName: 'analysis.measure', summary: 'Peak -3.1 dBFS on the drum bus.' },
                { callId: 'call-2', toolName: 'project.query', summary: 'Read the drum bus.' },
            ],
        });
        expect(reply?.error).toBeUndefined();
        expect(reply?.isCommandAction).toBeUndefined();
        expect(messages[0]?.isCommandAction).toBeUndefined();
    });

    it('creates no pending confirmation and offers none on the reply', async () => {
        await submitInChat();

        expect(mocks.persistPromptActionConfirmation).not.toHaveBeenCalled();
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
        expect(chatStore.value?.messages[1]?.pendingActionConfirmationId).toBeUndefined();
    });

    it('completes the run', async () => {
        await submitInChat();

        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('completed');
    });

    it('records the tool receipts it read on the run', async () => {
        await submitInChat();

        const receipts = agentRunLifecycle.get(RUN_ID)?.plan?.applicationToolReceipts;
        expect(receipts?.map((entry) => entry.callId)).toEqual(['call-1', 'call-2']);
    });

    it('still reports a decline as an error, so only an answer is exempt', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [],
                rawText: PROMPT,
                requiresConfirmation: false,
                planningOutcome: { kind: 'no-match' },
            },
            projectRevision: 'revision-1',
        });

        await submitInChat();

        const reply = chatStore.value?.messages[1];
        expect(reply?.error).toBe('No command matched the request.');
        expect(reply?.answerEvidence).toBeUndefined();
    });
});
