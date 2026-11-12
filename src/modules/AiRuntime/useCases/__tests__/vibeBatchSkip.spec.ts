import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { undoHistoryStore } from '#/modules/Command/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import {
    BASS_ID,
    DRUMS_ID,
    VOCAL_ID,
    cardContent,
    confirmBrief,
    proposedCards,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    scriptPlanningTurns,
    BRIEF_ROUTE,
    PROMPT,
    sendChatMessage,
    tearDownVibeRunFixture,
    trackDeviceTypes,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { skipPendingVibeBatch } from '../skipPendingVibeBatch';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * A vibe run lets the user skip one proposed batch and go on: the skipped batch never executes, the
 * next batch is grounded against what is applied, and the run ends with one summary of every batch.
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

// A committed batch builds a live strip and its EQ filters on this context, whose stubbed params
// carry no schedulable timeline, so only the per-parameter write to a live node is stubbed below.
vi.hoisted(() => {
    const OriginalAudioContext = globalThis.AudioContext;
    const createAudioParam = (value: number) => ({
        value,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
    });
    const createNode = () => ({
        connect: (destination: unknown) => destination,
        disconnect: () => undefined,
    });
    function AudioContextWithDeviceNodes(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return Object.assign(context, {
            currentTime: 0,
            createStereoPanner: () => ({ ...createNode(), pan: createAudioParam(0) }),
            createBiquadFilter: () => ({
                ...createNode(),
                type: 'lowpass',
                frequency: createAudioParam(350),
                Q: createAudioParam(1),
                gain: createAudioParam(0),
                detune: createAudioParam(0),
            }),
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        writable: true,
        value: AudioContextWithDeviceNodes,
    });
    const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;
    class AudioWorkletNodeWithClosablePort extends OriginalAudioWorkletNode {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
            super(context, name, options);
            if (typeof this.port.close !== 'function') {
                Object.defineProperty(this.port, 'close', { configurable: true, value: () => undefined });
            }
        }
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        writable: true,
        value: AudioWorkletNodeWithClosablePort,
    });
});

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    updateDeviceParam: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
});

afterEach(() => {
    tearDownVibeRunFixture();
});

/** Holds the skipped card's lease release open, so a test can end the run while a skip waits on it. */
const leaseRelease = vi.hoisted(() => ({ held: null as { reached: () => void; release: Promise<void> } | null }));
vi.mock('../../stores/pendingActionConfirmationStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../stores/pendingActionConfirmationStore')>();
    return {
        ...actual,
        settlePendingActionResourceLease: async (
            input: Parameters<typeof actual.settlePendingActionResourceLease>[0]
        ): Promise<void> => {
            const held = leaseRelease.held;
            if (held !== null) {
                held.reached();
                await held.release;
            }
            await actual.settlePendingActionResourceLease(input);
        },
    };
});

type RunSnapshot = NonNullable<ReturnType<typeof agentRunLifecycle.get>>;

function summaryMessages() {
    return (chatStore.value?.messages ?? []).filter((message) => message.content.startsWith('The vibe run '));
}

function skippedBatchIds(run: RunSnapshot | null): string[] {
    return (run?.batches ?? []).filter((batch) => batch.status === 'skipped').map((batch) => batch.batchId);
}

async function confirmCard(): Promise<void> {
    const card = requireOnlyProposedCard();
    await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
}

describe('skipping one batch of a vibe run', () => {
    afterEach(() => {
        leaseRelease.held = null;
    });

    it('skips batch 2 of 4 without executing it and proposes batch 3 next', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        expect(getAgentApprovalView({ confirmationId: drums.id })?.skip).toEqual({ available: true, reason: null });
        const revision = captureProjectRevision();
        const history = structuredClone(undoHistoryStore.value);
        const receipts = structuredClone(agentRunLifecycle.get(brief.runId)?.receipts);

        await expect(skipPendingVibeBatch({ confirmationId: drums.id })).resolves.toEqual({ status: 'skipped' });

        expect(cardContent(drums)).toMatch(/^Skipped batch 2 of 4:\n\n- .+$/su);
        expect(chatStore.value?.messages.find((message) => message.id === drums.assistantMessageId)).toMatchObject({
            pendingActionConfirmationStatus: 'cancelled',
        });
        const vocal = requireOnlyProposedCard();
        expect(vocal.approvalSnapshot.batchPosition).toEqual({ index: 3, total: 4 });
        expect(vocal.approvalSnapshot.adoptedRecipes?.map((recipe) => recipe.targetId)).toEqual([VOCAL_ID]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        // Nothing executed: the project, its undo history and the run's receipts are as they were.
        expect(captureProjectRevision()).toBe(revision);
        expect(undoHistoryStore.value).toEqual(history);
        const run = agentRunLifecycle.get(brief.runId);
        expect(run?.receipts).toEqual(receipts);
        const [skipped] = skippedBatchIds(run);
        expect(skipped).toBeDefined();
        expect(run?.receipts.some((receipt) => receipt.workId === skipped)).toBe(false);
        expect(run?.phase).toBe('waiting-for-approval');
        expect(summaryMessages()).toEqual([]);
    });

    it('grounds the batch after a skip at the live revision, from the project without the skipped batch', async () => {
        await confirmBrief();
        await confirmCard();
        const vocal = requireOnlyProposedCard();
        audio.renderTrackSubgraphOffline.mockClear();

        await expect(skipPendingVibeBatch({ confirmationId: vocal.id })).resolves.toEqual({ status: 'skipped' });

        const bass = requireOnlyProposedCard();
        expect(bass.approvalSnapshot.batchPosition).toEqual({ index: 4, total: 4 });
        expect(bass.projectRevision).toBe(captureProjectRevision());
        expect(bass.actions.some((action) => JSON.stringify(action).includes(VOCAL_ID))).toBe(false);
        const renders: RenderInput[] = audio.renderTrackSubgraphOffline.mock.calls.map((call) => call[0]);
        expect(renders.length).toBeGreaterThan(0);
        for (const render of renders) {
            expect(render.targetTrackId).toBe(BASS_ID);
            expect(render.renderTracks.find((track) => track.id === VOCAL_ID)?.devices ?? []).toEqual([]);
        }
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
    });

    it('completes the run when the final batch is skipped, posting one summary', async () => {
        const brief = await confirmBrief();
        await confirmCard();
        await confirmCard();
        const bass = requireOnlyProposedCard();

        await expect(skipPendingVibeBatch({ confirmationId: bass.id })).resolves.toEqual({ status: 'skipped' });

        expect(proposedCards()).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        const summaries = summaryMessages();
        expect(summaries).toHaveLength(1);
        expect(summaries[0]?.content).toMatch(
            /^The vibe run finished: the brief and 2 of 3 batches were applied\.\n- Batch 2 \(warm drums\): .+ on Drums .+\.\n- Batch 3 \(warm vocal\): .+ on Vocal .+\.\n- Batch 4 \(warm bass\): skipped, not applied\.$/u
        );
        expect(summaries[0]?.vibeRunRevert).toEqual({ runId: brief.runId });
    });

    it('says only the brief was applied when every batch is skipped, offering no revert', async () => {
        const brief = await confirmBrief();
        for (let position = 2; position <= 4; position += 1) {
            const card = requireOnlyProposedCard();
            expect(card.approvalSnapshot.batchPosition?.index).toBe(position);
            await expect(skipPendingVibeBatch({ confirmationId: card.id })).resolves.toEqual({ status: 'skipped' });
        }

        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
        const summaries = summaryMessages();
        expect(summaries).toHaveLength(1);
        expect(summaries[0]?.content).toBe(
            [
                'The vibe run finished: only the brief was applied; every batch was skipped.',
                '- Batch 2 (warm drums): skipped, not applied.',
                '- Batch 3 (warm vocal): skipped, not applied.',
                '- Batch 4 (warm bass): skipped, not applied.',
            ].join('\n')
        );
        expect(summaries[0]?.vibeRunRevert).toBeUndefined();
        expect([DRUMS_ID, VOCAL_ID, BASS_ID].map(trackDeviceTypes)).toEqual([[], [], []]);
    });

    it('refuses to skip the brief card and a card that is no longer pending', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        expect(getAgentApprovalView({ confirmationId: brief.id })?.skip.available).toBe(false);

        await expect(skipPendingVibeBatch({ confirmationId: brief.id })).resolves.toMatchObject({
            status: 'refused',
        });
        expect(requireOnlyProposedCard().id).toBe(brief.id);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('waiting-for-approval');

        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
        await expect(skipPendingVibeBatch({ confirmationId: brief.id })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'executed',
        });
        await expect(skipPendingVibeBatch({ confirmationId: 'no-such-card' })).resolves.toEqual({ status: 'missing' });
    });

    it('never executes a skipped batch, even when its card is confirmed afterwards', async () => {
        await confirmBrief();
        const drums = requireOnlyProposedCard();
        await expect(skipPendingVibeBatch({ confirmationId: drums.id })).resolves.toEqual({ status: 'skipped' });
        const history = structuredClone(undoHistoryStore.value);

        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'cancelled',
        });

        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(undoHistoryStore.value).toEqual(history);
        expect(requireOnlyProposedCard().approvalSnapshot.batchPosition).toEqual({ index: 3, total: 4 });
    });
    it('refuses a skip whose run was cancelled while the skip released its lease', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        let reached!: () => void;
        const waiting = new Promise<void>((resolve) => {
            reached = resolve;
        });
        let release!: () => void;
        leaseRelease.held = {
            reached,
            release: new Promise<void>((resolve) => {
                release = resolve;
            }),
        };

        const skip = skipPendingVibeBatch({ confirmationId: drums.id });
        await waiting;
        await expect(
            agentRunCancellation.cancel({ runId: brief.runId, reason: 'Cancelled by user' })
        ).resolves.toMatchObject({ status: 'cancelled', phase: 'partially-completed' });
        const cancelled = structuredClone(agentRunLifecycle.get(brief.runId)?.batches);
        expect(cancelled?.at(-1)?.status).toBe('cancelled');
        release();

        await expect(skip).resolves.toEqual({
            status: 'refused',
            reason: 'The run ended before the batch could be skipped.',
        });
        const run = agentRunLifecycle.get(brief.runId);
        expect(run?.phase).toBe('partially-completed');
        expect(run?.batches).toEqual(cancelled);
        expect(skippedBatchIds(run)).toEqual([]);
        expect(proposedCards()).toEqual([]);
        expect(summaryMessages()).toEqual([]);
        expect(cardContent(drums)).not.toContain('Skipped');
        expect(chatStore.value?.messages.find((message) => message.id === drums.assistantMessageId)).toMatchObject({
            pendingActionConfirmationStatus: 'cancelled',
        });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });
});
