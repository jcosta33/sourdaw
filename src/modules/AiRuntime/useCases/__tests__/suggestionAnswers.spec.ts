import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { capabilityStore } from '#/modules/BrowserAi/stores';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type AnswerSuggestion } from '../../models/PlanningOutcome';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { engineState } from '../../repositories/webLlm/engineLifecycleState';
import { getWebLlmArtifactManifestModel } from '../../repositories/webLlm/webLlmArtifactManifest';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { aiActionHistoryStore } from '../../stores/aiActionHistoryStore';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { proposeAnswerSuggestion } from '../aiPanelActions/proposeAnswerSuggestion';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { parsePromptToActions } from '../parsePromptToActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { advertisedAnswerCandidateId, advertisedAnswerIntake } from './answerWireFixture';

const provider = vi.fn<(params: Record<string, unknown>) => Promise<unknown>>();
const VOCAL_ID = 'track-lead-vocal';
const QUESTION = 'What would you do to make the lead vocal warmer?';
const RECIPE_TITLE = 'Chest-register lift with a softened upper shelf';
const OFFER =
    'Choose Propose this to prepare it for “Lead Vocal” as a proposal, using the middle of each authored window; nothing changes until you approve it.';

function discover(targetId: string | null, id = 'recipe'): ToolCallResult {
    return { id, name: 'recipe.discover', arguments: { descriptors: ['warm'], targetId, role: 'vocal', limit: 1 } };
}
function respond(statements: Array<Record<string, unknown>>): ToolCallResult {
    return { id: 'answer', name: 'answer.respond', arguments: { intakeCallId: 'intake', statements } };
}
function response(calls: ToolCallResult[]) {
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(calls) } }] };
}
/**
 * The provider's scripted turns: a catalog-knowledge intake about the lead vocal, read from what was
 * advertised, then each turn.
 */
function script(turns: ToolCallResult[][]): void {
    provider.mockImplementationOnce(async (params) =>
        response([
            advertisedAnswerIntake(params, {
                kind: 'catalog-knowledge',
                scopeCandidateIds: [advertisedAnswerCandidateId(params, VOCAL_ID)],
            }),
        ])
    );
    for (const calls of turns) {
        provider.mockResolvedValueOnce(response(calls));
    }
}
const RECIPE_STATEMENT = { kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' };

async function askForWarmth(turns: ToolCallResult[][] = [[discover(VOCAL_ID)], [respond([RECIPE_STATEMENT])]]) {
    script(turns);
    await sendChatMessage(QUESTION);
    const answer = chatStore.value?.messages.at(-1);
    if (answer === undefined) {
        throw new Error('The question produced no reply.');
    }
    return answer;
}

function confirmations() {
    return pendingActionConfirmationStore.value?.confirmations ?? [];
}
function vocalDevices() {
    return trackStore.value?.tracks.find((track) => track.id === VOCAL_ID)?.devices ?? [];
}
function lastReply() {
    return chatStore.value?.messages.at(-1);
}

function useArrangementHandlers(): void {
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
}

beforeEach(() => {
    provider.mockReset();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Suggestion answers');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureAiWorkflowCommandPreflightFixture();
    useArrangementHandlers();
    trackStore.set({
        tracks: [createTrack({ id: VOCAL_ID, name: 'Lead Vocal', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    markerStore.set({ markers: [], sections: [] });
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        name: 'Suggestion fixture',
        loading: false,
        initialized: true,
    });
    clearUndoHistory();
    clearChatMessages();
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    aiBackendPreferenceStore.set('webllm');
    capabilityStore.set({
        phase: 'done',
        report: {
            capability: 'supported',
            webGpu: { status: 'supported' },
            webGpuTier: 'not-measured',
            crossOriginIsolated: true,
            workerAvailable: true,
            opfsAvailable: true,
            inference: { status: 'not-measured', reason: 'not-requested' },
            detectedAt: 0,
        },
    });
    engineState.activeArtifactSetDigest = getWebLlmArtifactManifestModel(engineState.activeModelId).artifactSetDigest;
    engineState.engine = { interruptGenerate: vi.fn(), chat: { completions: { create: provider } } };
    llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: engineState.activeModelId });
    flushAutomergeStorageWrites();
});
afterEach(() => {
    vi.restoreAllMocks();
    clearHandlerRegistry();
    resetAiWorkflowCommandPreflightFixture();
    clearChatMessages();
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    engineState.engine = null;
    engineState.activeArtifactSetDigest = null;
    aiBackendPreferenceStore.set('auto');
    llmStatusStore.set({ state: 'idle' });
    capabilityStore.set({ phase: 'idle' });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('AC-003 a question about what to change answers with a recipe-backed suggestion', () => {
    it('describes the recipe and offers the follow-up, without creating a pending confirmation', async () => {
        const answer = await askForWarmth();

        expect(answer).toMatchObject({
            role: 'assistant',
            answerSuggestion: {
                recipeId: 'vocal-warm',
                recipeTitle: RECIPE_TITLE,
                targetId: VOCAL_ID,
                targetName: 'Lead Vocal',
                recipeRole: 'vocal',
                roleSource: 'argument',
            },
            projectRevision: captureProjectRevision(),
        });
        expect(answer.error).toBeUndefined();
        expect(answer.content.startsWith(`The catalog recipe “${RECIPE_TITLE}”`)).toBe(true);
        expect(answer.content.endsWith(OFFER)).toBe(true);
        expect(answer.pendingActionConfirmationId).toBeUndefined();
        expect(confirmations()).toEqual([]);
        expect(undoHistoryStore.value?.past ?? []).toEqual([]);
    });

    it('compiles the suggestion into exactly one pending proposal on request, asking the provider nothing', async () => {
        const answer = await askForWarmth();
        const providerCalls = provider.mock.calls.length;
        const aiHistoryBefore = structuredClone(aiActionHistoryStore.value);

        expect(await proposeAnswerSuggestion(answer.id)).toBe('requested');

        expect(provider.mock.calls.length).toBe(providerCalls);
        const pending = confirmations();
        expect(pending).toHaveLength(1);
        const [card] = pending;
        expect(card?.status).toBe('proposed');
        expect(card?.approvalSnapshot.adoptedRecipes).toEqual([
            { recipeId: 'vocal-warm', title: RECIPE_TITLE, targetId: VOCAL_ID },
        ]);
        expect(card?.approvalSnapshot.actions.map((action) => action.type)).toEqual([
            'addDevice',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
        ]);
        expect(card?.approvalSnapshot.actions[0]).toMatchObject({
            type: 'addDevice',
            payload: { trackId: VOCAL_ID, deviceType: 'builtin-eq' },
        });
        expect(
            card?.approvalSnapshot.actions.flatMap((action) =>
                action.type === 'setDeviceParameter' ? [[action.payload.paramId, action.payload.value]] : []
            )
        ).toEqual([
            ['eq-low-freq', 160],
            ['eq-low-gain', 2.25],
            ['eq-high-freq', 10_500],
            ['eq-high-gain', -1.5],
        ]);
        expect(lastReply()).toMatchObject({
            role: 'assistant',
            pendingActionConfirmationId: card?.id,
            pendingActionConfirmationStatus: 'proposed',
        });
        expect(vocalDevices()).toEqual([]);
        expect(undoHistoryStore.value?.past ?? []).toEqual([]);
        expect(aiActionHistoryStore.value).toEqual(aiHistoryBefore);
    });

    it('leaves the card confirmable, since a chosen recipe states no objective to verify', async () => {
        const answer = await askForWarmth();
        await proposeAnswerSuggestion(answer.id);
        const [card] = confirmations();
        if (card === undefined) {
            throw new Error('The suggestion produced no card.');
        }

        const view = getAgentApprovalView({ confirmationId: card.id });

        expect(view?.metricGoals.status).toBe('not-required');
        expect(view?.canConfirm).toBe(true);
    });

    it('refuses once another project is open, planning nothing and saying why', async () => {
        const answer = await askForWarmth();
        resetCrdtProjectAuthority('Switch project');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        const providerCalls = provider.mock.calls.length;

        expect(await proposeAnswerSuggestion(answer.id)).toBe('project-switched');

        expect(provider.mock.calls.length).toBe(providerCalls);
        expect(confirmations()).toEqual([]);
        expect(lastReply()?.error).toBe(
            'This answer was about another project, so its suggestion cannot be proposed here.'
        );
    });

    it('refuses once the project changed since the answer, planning nothing and saying why', async () => {
        const answer = await askForWarmth();
        await executeAppAction({ type: 'renameTrack', payload: { trackId: VOCAL_ID, name: 'Lead Vox' } });

        expect(await proposeAnswerSuggestion(answer.id)).toBe('project-changed');

        expect(confirmations()).toEqual([]);
        expect(lastReply()?.error).toBe(
            'The project has changed since this answer, so its suggestion may no longer fit. Ask again for a current one.'
        );
    });

    it('refuses while the thread already holds a pending proposal, leaving that card alone', async () => {
        const answer = await askForWarmth();
        await proposeAnswerSuggestion(answer.id);
        const [card] = confirmations();

        await proposeAnswerSuggestion(answer.id);

        expect(confirmations()).toHaveLength(1);
        expect(confirmations()[0]).toMatchObject({ id: card?.id, status: 'proposed' });
        expect(lastReply()?.error).toBe(
            'A proposal is already waiting in this chat. Confirm or cancel it before proposing this suggestion.'
        );
    });

    it('offers no suggestion for two recipe statements', async () => {
        const answer = await askForWarmth([[discover(VOCAL_ID)], [respond([RECIPE_STATEMENT, RECIPE_STATEMENT])]]);

        expect(answer.error).toBeUndefined();
        expect(answer.content.startsWith(`The catalog recipe “${RECIPE_TITLE}”`)).toBe(true);
        expect(answer.answerSuggestion).toBeUndefined();
        expect(answer.content).not.toContain('Propose this');
        expect(await proposeAnswerSuggestion(answer.id)).toBe('unavailable');
        expect(confirmations()).toEqual([]);
    });

    it('offers no suggestion when discovery named no target', async () => {
        const answer = await askForWarmth([[discover(null)], [respond([RECIPE_STATEMENT])]]);

        expect(answer.error).toBeUndefined();
        expect(answer.content.startsWith(`The catalog recipe “${RECIPE_TITLE}”`)).toBe(true);
        expect(answer.answerSuggestion).toBeUndefined();
        expect(answer.content).not.toContain('Propose this');
        expect(confirmations()).toEqual([]);
    });
});

describe('the planner re-reads the suggested target against the live project', () => {
    const suggestion: AnswerSuggestion = {
        recipeId: 'vocal-warm',
        recipeTitle: RECIPE_TITLE,
        targetId: VOCAL_ID,
        targetName: 'Lead Vocal',
        recipeRole: 'vocal',
        roleSource: 'argument',
    };

    async function planSuggestion(context: ReturnType<typeof getProjectContext>) {
        return parsePromptToActions({
            prompt: 'Propose this',
            context,
            projectRevision: captureProjectRevision(),
            providerPlanning: 'disabled',
            thread: null,
            suggestion,
        });
    }

    it('compiles a batch for the live target', async () => {
        const result = await planSuggestion(getProjectContext());

        expect(result.rejectionReason).toBeUndefined();
        expect(result.requiresConfirmation).toBe(true);
        expect(result.actions).toHaveLength(5);
    });

    it('refuses a target removed since the answer', async () => {
        const context = getProjectContext();
        context.tracks = [];

        const result = await planSuggestion(context);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'The track “Lead Vocal” is no longer in the project, so the suggestion cannot be prepared.'
        );
    });

    it('refuses a target frozen since the answer', async () => {
        const context = getProjectContext();
        context.tracks = context.tracks.map((track) => ({ ...track, frozen: true }));

        const result = await planSuggestion(context);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            `The suggestion cannot be prepared for “Lead Vocal”: recipe.expand refused target "${VOCAL_ID}": it is frozen, and device changes are refused while it is frozen.`
        );
    });
});
