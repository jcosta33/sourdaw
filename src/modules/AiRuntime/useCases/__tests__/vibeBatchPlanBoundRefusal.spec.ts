import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';

import {
    confirmBrief,
    proposedCards,
    renderTrack,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    tearDownVibeRunFixture,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const RECEIPT_BOUND = 1024;

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

function paddingReceipt(index: number): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: `padding-${String(index)}`,
        toolName: 'analysis.measure',
        turn: 0,
        origin: 'application-verification',
        revision: 'revision-1',
        status: 'success',
        data: {},
        summary: 'Measured preview.',
        warnings: [],
        error: null,
    };
}

/** Fills the run's plan to its receipt bound, so the next batch preview's receipts cannot be kept. */
function fillPlanReceipts(runId: string): void {
    const run = agentRunLifecycle.get(runId);
    const kept = run?.plan?.applicationToolReceipts ?? [];
    if (run?.plan === null || run?.plan === undefined) {
        throw new Error('Expected the run to hold a plan.');
    }
    agentRunLifecycle.recordApplicationToolEvidence({
        runId,
        summary: run.plan.summary,
        applicationToolReceipts: [
            ...kept,
            ...Array.from({ length: RECEIPT_BOUND - kept.length }, (_, index) => paddingReceipt(index)),
        ],
        revision: run.revisions.planned ?? 'revision-1',
        scope: run.scope,
        grants: run.grants,
        budgets: run.budgets,
    });
}

describe('a vibe batch whose preview evidence the run plan cannot keep', () => {
    it('refuses the batch and settles its preview message with no progress line or Stop left on it', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => renderTrack(input));
        fillPlanReceipts(brief.runId);

        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({ status: 'executed' });

        const messages = chatStore.value?.messages ?? [];
        expect(messages.filter((message) => message.content.includes('rendering'))).toEqual([]);
        expect(messages.filter((message) => message.stoppableRunId !== undefined)).toEqual([]);
        expect(messages.find((message) => message.content.startsWith('Stopped preparation of batch 3'))).toMatchObject({
            content: 'Stopped preparation of batch 3 of 4. Batches 1–2 remain applied.',
        });
        expect(messages.find((message) => message.content.startsWith('Batch 3 of 4 was not proposed'))?.content).toBe(
            `Batch 3 of 4 was not proposed: the run's plan cannot hold more than ${String(RECEIPT_BOUND)} entries in applicationToolReceipts. Batches 1–2 remain applied.`
        );
        expect(proposedCards()).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });
});
