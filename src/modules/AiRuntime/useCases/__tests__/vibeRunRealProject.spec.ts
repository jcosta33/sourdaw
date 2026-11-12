import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    audioEngine,
    initEngineDeviceCollaborators,
    removeTrackStrip,
    type renderTrackSubgraphOffline,
} from '#/modules/AudioEngine/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
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
    renderVibeTimeline,
    requireOnlyProposedVibeCard,
    scriptVibeBriefRoute,
    seedVibeBrief,
    sendVibeMessage,
    SECONDS_PER_BEAT,
    vibeCardContent,
    vibeSections,
    vibeTrack,
    type VibeRenderInput,
    type VibeTrackSpec,
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
const SECTION_BEATS = 8;
const SECTIONS = vibeSections(
    ['Intro', 'Verse 1', 'Pre Chorus', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'],
    SECTION_BEATS
);
const SONG_BEATS = SECTIONS.length * SECTION_BEATS;

const FAMILY_TRACKS: Readonly<Record<string, readonly (readonly [name: string, role: string])[]>> = {
    drums: [
        ['Kick', 'kick'],
        ['Snare', 'snare'],
        ['Hats', 'hi-hat'],
        ['Toms', 'tom'],
        ['Overheads', 'overhead'],
        ['Room', 'room'],
        ['Shaker', 'percussion'],
    ],
    vocal: [
        ['Lead Vox', 'lead vocal'],
        ['Double', 'lead vocal'],
        ['Harmony High', 'backing vocal'],
        ['Harmony Low', 'backing vocal'],
        ['Ad Libs', 'backing vocal'],
    ],
    bass: [
        ['Bass DI', 'bass'],
        ['Bass Amp', 'bass'],
    ],
    guitar: [
        ['Rhythm L', 'guitar'],
        ['Rhythm R', 'guitar'],
        ['Lead Gtr', 'guitar'],
        ['Acoustic', 'guitar'],
    ],
    keys: [
        ['Piano', 'keys'],
        ['Rhodes', 'keys'],
        ['Organ', 'keys'],
        ['Synth Lead', 'synth'],
        ['Pad', 'pad'],
        ['Strings', 'strings'],
    ],
};

const TRACKS: VibeTrackSpec[] = Object.values(FAMILY_TRACKS).flatMap((tracks) =>
    tracks.map(([name, role]) => ({ id: `track-${name.toLowerCase().replaceAll(' ', '-')}`, name, role }))
);
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
    initEngineDeviceCollaborators();
    setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' as const }),
        clear: () => undefined,
    });
    clearAiHistory();
    setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
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
    for (const track of TRACKS) {
        removeTrackStrip(track.id);
    }
    audioEngine.setUseCaseDeviceCollaborators(null);
    clearAiHistory();
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
