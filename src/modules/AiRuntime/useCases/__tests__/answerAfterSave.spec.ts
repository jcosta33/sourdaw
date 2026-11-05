import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { readAgentRunState } from '../../stores/agentRunStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import { clearPendingActionConfirmations } from '../../stores/pendingActionConfirmationStore';
import { orchestratePromptChatRequest } from '../agentRequestOrchestration/orchestratePromptChatRequest';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProjectContext } from '../getProjectContext';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerSupportingServicePorts();

// The completion checks are the real ones over a real CRDT document and a real save write; only the
// planner, which would ask a provider, and the Prompt Bar notice are replaced.
const mocks = vi.hoisted(() => ({
    planPromptActions: vi.fn<typeof import('../planPromptActions').planPromptActions>(),
    notifyAiAnswer: vi.fn<typeof import('../notifyAiAnswer').notifyAiAnswer>(),
}));
vi.mock('../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../notifyAiAnswer', () => ({ notifyAiAnswer: mocks.notifyAiAnswer }));
vi.mock('../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: () => 'fixture-model' }));

const PROMPT = 'How loud is the drum bus?';
const ANSWER_TEXT = 'The drum bus peaks at -3.1 dBFS.';

type ProjectWrite = 'save' | 'edit';

/** The planner answers against the revision it captured, and the project is written before the answer completes. */
function answerAcross(write: ProjectWrite): void {
    mocks.planPromptActions.mockImplementation(async () => {
        const projectRevision = captureProjectRevision();
        if (write === 'edit') {
            moveTrackFader('track-1', 0.5);
        }
        await writeProjectSave();
        return {
            context: getProjectContext(),
            result: {
                actions: [],
                rawText: PROMPT,
                requiresConfirmation: false,
                applicationToolReceipts: [],
                planningOutcome: { kind: 'answer', text: ANSWER_TEXT, evidence: [] },
            },
            projectRevision,
        };
    });
}

async function askInChat(): Promise<void> {
    await orchestratePromptChatRequest({
        userText: PROMPT,
        requestedRoute: 'auto',
        backend: 'webllm',
        interactionMode: 'apply',
        options: undefined,
    });
}

function chatReply() {
    return chatStore.value?.messages.find((message) => message.role === 'assistant');
}

function onlyRun() {
    const runs = readAgentRunState().runs;
    expect(runs).toHaveLength(1);
    return runs[0];
}

beforeEach(() => {
    mocks.planPromptActions.mockReset();
    mocks.notifyAiAnswer.mockReset();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('answer after save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearPendingActionConfirmations();
    clearChatMessages();
    agentRunLifecycle.clear();
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    trackStore.set({
        tracks: [createTrack({ id: 'track-1', name: 'Drum Bus', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    seedSavableProject();
});

afterEach(() => {
    clearPendingActionConfirmations();
    clearChatMessages();
    agentRunLifecycle.clear();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('an answer composed across a save', () => {
    it('replies in the chat when the project was saved while the answer was composed', async () => {
        answerAcross('save');

        await askInChat();

        expect(chatReply()).toMatchObject({ content: ANSWER_TEXT });
        expect(chatReply()?.error).toBeUndefined();
        expect(onlyRun()?.phase).toBe('completed');
    });

    it('replies with no answer in the chat once a fader moved while it was composed, saved or not', async () => {
        answerAcross('edit');

        await askInChat();

        expect(chatReply()?.content).not.toBe(ANSWER_TEXT);
        expect(onlyRun()).toMatchObject({
            phase: 'cancelled',
            cancellation: { reason: new AiProposalInvalidatedError().message },
        });
    });

    it('shows the Prompt Bar notice when the project was saved while the answer was composed', async () => {
        answerAcross('save');

        await expect(submitAdmittedPromptRequest({ prompt: PROMPT, source: 'prompt-bar' })).resolves.toMatchObject({
            status: 'no-op',
        });
        expect(mocks.notifyAiAnswer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: ANSWER_TEXT }));
    });

    it('shows no Prompt Bar notice once a fader moved while the answer was composed, saved or not', async () => {
        answerAcross('edit');

        await expect(submitAdmittedPromptRequest({ prompt: PROMPT, source: 'prompt-bar' })).rejects.toThrow(
            AiProposalInvalidatedError
        );
        expect(mocks.notifyAiAnswer).not.toHaveBeenCalled();
    });
});
