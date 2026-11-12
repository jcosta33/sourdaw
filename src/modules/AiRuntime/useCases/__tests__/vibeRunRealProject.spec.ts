import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import {
    APPLICATION_OWNED_TOOL_LOOP_LIMITS,
    APPLICATION_VERIFICATION_RECEIPT_LIMITS,
} from '../applicationOwnedToolLoop';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { sendChatMessage } from '../sendChatMessage';

import { configureMetricGoalProject, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import {
    ORDINARY_SONG_BEATS as SONG_BEATS,
    ORDINARY_SONG_SECTIONS as SECTIONS,
    ORDINARY_SONG_TRACKS as TRACKS,
    prepareVibeRunEngine,
    releaseVibeRunEngine,
    renderVibeTimeline,
    requireOnlyProposedVibeCard,
    scriptVibeBriefRoute,
    seedVibeBrief,
    sendVibeMessage,
    SECONDS_PER_BEAT,
    vibeCardContent,
    vibeTrack,
    type VibeRenderInput,
} from './vibeRunProjectFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * #4372 requirement 2: a whole-project vibe run over a song of ordinary size — five role families of
 * unequal size, one larger than a batch holds, eight sections and two requested characters — fits
 * the default resource limits and plans every plannable track into a batch.
 */
const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'openai', model: 'hosted-model', baseUrl: 'https://api.openai.com/v1' }),
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted provider planning request.');
    }),
}));

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn<typeof renderTrackSubgraphOffline>(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

/** Two dozen tracks render real buffers through the real measurement path, which takes longer than a unit case. */
const REAL_PROJECT_TIMEOUT_MS = 60_000;

/** The acoustic guitar rests through the intro. */
const RESTING_ID = 'track-acoustic';
const INTRO = SECTIONS[0]!;

function renderSong(input: VibeRenderInput): AudioBuffer {
    return renderVibeTimeline(input, (seconds) =>
        input.targetTrackId === RESTING_ID && seconds < INTRO.endBeat * SECONDS_PER_BEAT ? 0 : 1
    );
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'ordinary-size vibe run test',
        tracks: TRACKS.map((spec) => vibeTrack(spec, SONG_BEATS)),
        sections: SECTIONS,
    });
    registerHandlerMap(getProjectHandlers());
    prepareVibeRunEngine();
    seedVibeBrief(TRACKS);
    vi.mocked(generateToolPlanningOutcome).mockReset();
    runtimeMocks.backend.value = 'cloud';
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input) => renderSong(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped run must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A run must be measured on its rendered scope, never on source audio.');
    });
});

afterEach(() => {
    releaseVibeRunEngine(TRACKS);
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    resetMetricGoalProject();
    vi.restoreAllMocks();
});

describe('a whole-project vibe run on a song of ordinary size', () => {
    it(
        'schedules every plannable track into a batch under the default resource limits',
        async () => {
            scriptVibeBriefRoute({ descriptors: ['warm', 'wide'] });

            await sendVibeMessage('make this mix warmer and wider', (prompt) => sendChatMessage(prompt));

            const brief = requireOnlyProposedVibeCard();
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            expect(vibeCardContent(brief)).not.toContain('No batches were scheduled');
            if (schedule?.kind !== 'vibe-run') {
                throw new Error(`Expected a scheduled vibe run: ${vibeCardContent(brief)}`);
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            const batched = new Set(plan?.batches.flatMap((batch) => batch.targetIds));
            expect(batched).toEqual(new Set(TRACKS.map((track) => track.id)));
            expect(plan?.batches.some((batch) => batch.targets.some((target) => target.recipeIds.length > 1))).toBe(
                true
            );
            // One render per track covers the arrangement and every section.
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(TRACKS.length);
        },
        REAL_PROJECT_TIMEOUT_MS
    );

    it(
        'admits the initial figures and the first batch preview within the verification-receipt allowance',
        async () => {
            scriptVibeBriefRoute({ descriptors: ['warm', 'wide'] });
            await sendVibeMessage('make this mix warmer and wider', (prompt) => sendChatMessage(prompt));
            const brief = requireOnlyProposedVibeCard();
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });

            const card = requireOnlyProposedVibeCard();
            expect(card.approvalSnapshot.batchPosition?.index).toBe(2);
            const receipts = agentRunLifecycle.get(brief.runId)?.plan?.applicationToolReceipts ?? [];
            const verification = receipts.filter((receipt) => receipt.origin === 'application-verification');
            const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
            const initial = verification.filter((receipt) => receipt.callId.startsWith('vibe-initial-'));
            const preview = verification.filter((receipt) => receipt.callId.startsWith('goal-measure-'));
            // One receipt per target chunk and exact range: the 24 tracks in six chunks over nine ranges.
            expect(initial).toHaveLength(6 * 9);
            expect(preview.length).toBeGreaterThan(0);
            // Every read was admitted: none was turned into a spent-budget refusal.
            expect(verification.filter((receipt) => receipt.status === 'failure')).toEqual([]);
            // Each collection alone is past what a provider turn may carry, and inside its own allowance.
            for (const collection of [initial, preview]) {
                expect(byteLength(collection)).toBeGreaterThan(
                    APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerTurn
                );
                expect(byteLength(collection)).toBeLessThanOrEqual(
                    APPLICATION_VERIFICATION_RECEIPT_LIMITS.maxBytesPerCollection
                );
            }
            expect(byteLength(receipts)).toBeLessThanOrEqual(APPLICATION_VERIFICATION_RECEIPT_LIMITS.maxTotalBytes);
        },
        REAL_PROJECT_TIMEOUT_MS * 2
    );
});
