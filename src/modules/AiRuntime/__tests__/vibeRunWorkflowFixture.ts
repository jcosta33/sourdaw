import { expect, type Mock, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    initEngineDeviceCollaborators,
    removeTrackStrip,
    type renderTrackSubgraphOffline,
} from '#/modules/AudioEngine/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../models/AgentResourceLimits';
import { type ToolCallResult } from '../models/ToolCallResult';
import { type ToolSchema } from '../models/ToolDefinitions';
import { agentResourceLimitsStore } from '../stores/agentResourceLimitsStore';
import { clearAiHistory } from '../stores/aiActionHistoryStore';
import { chatStore } from '../stores/chatStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../useCases/confirmPendingChatActions';
import { getBriefMixIntentCatalog } from '../useCases/getBriefMixIntentCatalog';
import { generateToolPlanningOutcome } from '../useCases/llmOrchestration/inference';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../useCases/sendChatMessage';
import {
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from '../useCases/__tests__/highLevelIntentWorkflowFixture';
import { landProjectEdit } from '../useCases/__tests__/landProjectEdit';
import {
    configureMetricGoalProject,
    metricGoalAudioBuffer,
    resetMetricGoalProject,
} from '../useCases/__tests__/metricGoalWorkflowFixture';

/**
 * The whole-project vibe run of #4372 as its specs drive it: a three-track project, the scripted
 * brief route, and a renderer whose figures follow the EQ shelves each track carries. A spec using it
 * mocks the provider planning inference, the backend resolution and the AudioEngine renders itself,
 * since `vi.mock` hoists only inside the spec file, and hands its render mocks to `resetVibeRunFixture`.
 */
export const PROMPT = 'make this mix warmer and more open';
export const BRIEF_REVISION = 4;
export const PLANNED_BRIEF_REVISION = BRIEF_REVISION + 1;

export const DRUMS_ID = 'track-drums';
export const VOCAL_ID = 'track-vocal';
export const BASS_ID = 'track-bass';

export type RenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];
type ProviderRequest = { userMessage: string; schemas: readonly ToolSchema[] };
export type ScriptedPlanningTurn = (request: ProviderRequest) => ToolCallResult[];
type ProductionBrief = NonNullable<typeof projectStore.value>['productionBrief'];
export type Confirmation = NonNullable<typeof pendingActionConfirmationStore.value>['confirmations'][number];

export type VibeRunRenderMocks = {
    renderTrackSubgraphOffline: Mock;
    renderOffline: Mock;
    renderOfflineInput: Mock;
};

export const briefIntake: ScriptedPlanningTurn = ({ userMessage, schemas }) => {
    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
    const base = selectCreativeInterpretationCall({ catalog, modeId: 'brief' });
    return [
        {
            ...base,
            id: 'brief-intake',
            arguments: {
                ...base.arguments,
                answer: null,
                metricIntent: { kind: 'non-acoustic', uncertainty: 'none', objectives: [] },
            },
        },
    ];
};

const compileBrief: ScriptedPlanningTurn = () => [
    {
        id: 'brief-compile',
        name: 'brief.compile',
        arguments: {
            vision: 'A warmer, more open mix',
            mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: ['warm'] },
        },
    },
];

export const proposeBrief: ScriptedPlanningTurn = () => [
    {
        id: 'brief-proposal',
        name: 'command.batch.propose',
        arguments: {
            commands: [],
            compiledCallIds: ['brief-compile'],
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Record the project intent the request describes.',
                constraints: [],
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                capabilityIds: [],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Compare the brief revision before writing.'],
                stoppingConditions: ['Stop if the brief changes before Confirm.'],
            },
        },
    },
];

export const BRIEF_ROUTE = [briefIntake, compileBrief, proposeBrief];

export function scriptPlanningTurns(turns: readonly ScriptedPlanningTurn[]): ProviderRequest[] {
    const requests: ProviderRequest[] = [];
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        const request = { userMessage, schemas };
        requests.push(request);
        const turn = turns[requests.length - 1];
        if (turn === undefined) {
            throw new Error(`Expected at most ${String(turns.length)} provider turns`);
        }
        return { status: 'complete', toolCalls: turn(request) };
    });
    return requests;
}

function clip(trackId: string) {
    return {
        id: `${trackId}-clip`,
        trackId,
        name: 'Take',
        type: 'audio' as const,
        audioBufferId: `${trackId}-buffer`,
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function sourceTrack(id: string, name: string) {
    return { ...createTrack({ id, name, kind: 'audio' }), clips: [clip(id)] };
}

function seededBrief(): ProductionBrief {
    return {
        ...structuredClone(defaultProjectStoreState.productionBrief),
        revision: BRIEF_REVISION,
        createdAt: 100,
        updatedAt: 100,
    };
}

/**
 * Every track sounds a 100 Hz body beside a 3 kHz top, each scaled by the low and high shelf gains
 * of the EQs it carries, so a warming recipe raises the bass band and lowers the centroid.
 */
export function renderTrack(input: RenderInput): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const parameter = (id: string) =>
        track.devices.reduce((total, device) => total + (device.parameterValues[id] ?? 0), 0);
    const low = 10 ** (parameter('eq-low-gain') / 20);
    const high = 10 ** (parameter('eq-high-gain') / 20);
    const seconds = (input.endBeat - input.startBeat) / 2;
    return metricGoalAudioBuffer(
        (time) => 0.4 * low * Math.sin(2 * Math.PI * 100 * time) + 0.2 * high * Math.sin(2 * Math.PI * 3000 * time),
        seconds
    );
}

export async function sendChatMessage(
    prompt: string,
    options?: Parameters<typeof sendChatMessageWithoutDocumentFlush>[1]
) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt, options);
}

export function proposedCards(): Confirmation[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? []).filter((card) => card.status === 'proposed');
}

export function requireOnlyProposedCard(): Confirmation {
    const cards = proposedCards();
    if (cards.length !== 1 || cards[0] === undefined) {
        const last = chatStore.value?.messages.at(-1);
        throw new TypeError(
            `Expected one proposed card, found ${String(cards.length)}: ${last?.error ?? last?.content ?? 'no reply'}`
        );
    }
    return cards[0];
}

export function cardContent(card: Confirmation): string {
    return chatStore.value?.messages.find((message) => message.id === card.assistantMessageId)?.content ?? '';
}

export function lastMessage(): string {
    return chatStore.value?.messages.at(-1)?.content ?? '';
}

export function trackDeviceTypes(trackId: string): string[] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.devices.map((device) => device.type) ?? [];
}

export function liveBriefRevision(): number {
    return projectStore.value?.productionBrief.revision ?? -1;
}

/** Writes the brief one revision on, as a user's own brief edit does, through its typed command. */
export async function editBrief(): Promise<void> {
    const brief = projectStore.value?.productionBrief;
    if (brief === undefined) {
        throw new TypeError('Expected an open project with a brief');
    }
    await executeAppAction({
        type: 'setProductionBrief',
        payload: {
            expectedRevision: brief.revision,
            brief: { ...structuredClone(brief), revision: brief.revision + 1, vision: 'Dark and close instead' },
        },
    });
}

/** Sends the request and confirms its brief card, so the run proposes its first batch. */
export async function confirmBrief(): Promise<Confirmation> {
    scriptPlanningTurns(BRIEF_ROUTE);
    await sendChatMessage(PROMPT);
    const brief = requireOnlyProposedCard();
    await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
    return brief;
}

/** Opens the three-track project with the seeded brief and arms the provider and render mocks. */
export function resetVibeRunFixture(audio: VibeRunRenderMocks, backend: { value: string }): void {
    configureMetricGoalProject({
        label: 'multi-batch vibe run test',
        tracks: [sourceTrack(DRUMS_ID, 'Drums'), sourceTrack(VOCAL_ID, 'Vocal'), sourceTrack(BASS_ID, 'Bass')],
        sections: [],
    });
    registerHandlerMap(getProjectHandlers());
    initEngineDeviceCollaborators();
    setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' as const }),
        clear: () => undefined,
    });
    clearAiHistory();
    setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
    landProjectEdit(() => {
        projectStore.set({ ...structuredClone(defaultProjectStoreState), productionBrief: seededBrief() });
    });
    vi.mocked(generateToolPlanningOutcome).mockReset();
    backend.value = 'cloud';
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input: RenderInput) => renderTrack(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped batch must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A batch must be measured on its rendered scope, never on source audio.');
    });
}

export function tearDownVibeRunFixture(): void {
    for (const trackId of [DRUMS_ID, VOCAL_ID, BASS_ID]) {
        removeTrackStrip(trackId);
    }
    audioEngine.setUseCaseDeviceCollaborators(null);
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    clearAiHistory();
    resetMetricGoalProject();
    vi.restoreAllMocks();
}
