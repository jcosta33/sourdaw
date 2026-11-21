import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import {
    type AnthropicCloudRuntime,
    type OpenAiCompatibleCloudRuntime,
} from '../../repositories/cloudLlm/cloudSession';
import { chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

registerDeviceEnginePorts();

const backend = vi.hoisted(() => ({
    chain: { value: [] as ('cloud' | 'webllm')[] },
    getCloudProviderInfo: vi.fn(),
    generateCloudToolCalls: vi.fn(),
}));
const hostedRuntime = vi.hoisted(() => ({
    current: null as ReturnType<
        typeof import('../../repositories/cloudLlm/getCloudProviderRuntime').getCloudProviderRuntime
    >,
}));
const requestAnthropic = vi.hoisted(() => vi.fn());
const requestOpenAiResponses = vi.hoisted(() => vi.fn());

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => backend.chain.value,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: backend.generateCloudToolCalls,
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: backend.getCloudProviderInfo,
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderRuntime', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../repositories/cloudLlm/getCloudProviderRuntime')>();
    return { getCloudProviderRuntime: () => hostedRuntime.current ?? original.getCloudProviderRuntime() };
});
vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: () => hostedRuntime.current !== null,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: requestAnthropic,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: requestOpenAiResponses,
}));

const anthropicRuntime: AnthropicCloudRuntime = {
    provider: 'anthropic',
    authentication: 'api-key',
    model: 'claude-test',
    session_id: 'provider-session-00000000000000000000000000000000',
};
const compatibleRuntime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: 'compatible-model',
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: false,
};
const DIALECTS = {
    anthropic: {
        runtime: anthropicRuntime,
        info: {
            provider: 'anthropic',
            model: 'claude-test',
            baseUrl: 'https://api.anthropic.com',
            authentication: 'api-key',
        },
    },
    openAiCompatible: {
        runtime: compatibleRuntime,
        info: {
            provider: 'openai-compatible',
            model: 'compatible-model',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
        },
    },
} as const;
type Dialect = keyof typeof DIALECTS;
const DIALECT_NAMES = Object.keys(DIALECTS) as Dialect[];

const EXPLAIN_QUESTION = 'why does the drum bus sound so loud';
const PLAN_PROMPT = 'make the drums punchier';

function verificationReceipt(callId: string, toolName: string, summary: string): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId,
        toolName,
        turn: 0,
        origin: 'application-verification',
        status: 'success',
        revision: null,
        data: { summary },
        summary,
        warnings: [],
        error: null,
    };
}

const BASELINE_RECEIPT = verificationReceipt(
    'verification-baseline-drums-7f3a',
    'analysis.measure',
    'Initial baseline VERIFY-BASELINE-4471 drums integrated loudness -14.2 LUFS true peak -1.3 dBTP'
);
const PREVIEW_RECEIPT = verificationReceipt(
    'verification-preview-batch-1-9c2e',
    'analysis.measure',
    'Batch preview VERIFY-PREVIEW-8825 drums integrated loudness -12.9 LUFS true peak -0.4 dBTP'
);
const VERIFICATION_RECEIPTS = [BASELINE_RECEIPT, PREVIEW_RECEIPT];

/** Every string a verification receipt could reach a provider as. */
const FORBIDDEN_TEXTS = [
    BASELINE_RECEIPT.callId,
    BASELINE_RECEIPT.summary,
    'VERIFY-BASELINE-4471',
    PREVIEW_RECEIPT.callId,
    PREVIEW_RECEIPT.summary,
    'VERIFY-PREVIEW-8825',
    'application-verification',
];

function selectHostedDialect(dialect: Dialect): void {
    hostedRuntime.current = DIALECTS[dialect].runtime;
    backend.chain.value = ['cloud'];
    backend.getCloudProviderInfo.mockReturnValue(DIALECTS[dialect].info);
}

/** Every body a hosted request puts on the wire while `action` runs, as the text the provider receives. */
async function recordHostedBodies(action: () => Promise<unknown>): Promise<string[]> {
    const sent: string[] = [];
    const reply = (wire: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
        sent.push(wire.body);
        wire.onBodyChunk(new TextEncoder().encode('{}'));
        return Promise.resolve({ status: 200, contentType: 'application/json' });
    };
    requestAnthropic.mockImplementation(reply);
    requestOpenAiResponses.mockImplementation(reply);
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((_url, init) => {
            if (typeof init?.body !== 'string') {
                throw new TypeError('Expected a JSON request body.');
            }
            sent.push(init.body);
            return Promise.resolve(
                new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
            );
        })
    );
    // The doubled provider answers `{}`, so the request may settle rejected; only the bodies it sent matter.
    await Promise.allSettled([action()]);
    return sent;
}

/** Gives the run a request admits a plan that holds the application's own verification receipts. */
function holdVerificationReceipts(runId: string): void {
    agentRunLifecycle.recordPlan({
        runId,
        summary: 'Vibe run initial baselines and a batch preview.',
        commandIds: [],
        serializedBatchIdentity: 'verification-batch',
        revision: 'revision-a',
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: { limits: {}, consumed: {} },
        applicationToolReceipts: structuredClone(VERIFICATION_RECEIPTS),
    });
}

type Request = { bodies: string[]; heldReceiptIds: string[] };

async function sendWithVerificationReceipts(text: string, mode: 'explain' | 'plan'): Promise<Request> {
    const heldReceiptIds: string[] = [];
    const bodies = await recordHostedBodies(() =>
        sendChatMessage(text, {
            mode,
            onResumedRunAdmitted: (runId) => {
                holdVerificationReceipts(runId);
                const held = agentRunLifecycle.get(runId)?.plan?.applicationToolReceipts ?? [];
                heldReceiptIds.push(...held.map((receipt) => receipt.callId));
            },
        })
    );
    return { bodies, heldReceiptIds };
}

beforeEach(() => {
    configureAiWorkflowCommandPreflightFixture();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('verification receipt egress test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    trackStore.set({
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            createTrack({ id: 'drums', name: 'Drums', kind: 'audio' }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
    backend.chain.value = [];
    backend.getCloudProviderInfo.mockReset();
    backend.generateCloudToolCalls.mockReset();
    agentRunLifecycle.clear();
    chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'chat' });
});

afterEach(async () => {
    const actual = await vi.importActual<
        typeof import('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls')
    >('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls');
    backend.generateCloudToolCalls.mockImplementation(actual.generateCloudToolCalls);
    agentRunLifecycle.clear();
    resetAiWorkflowCommandPreflightFixture();
    clearHandlerRegistry();
    clearUndoHistory();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    vi.unstubAllGlobals();
    hostedRuntime.current = null;
});

describe.each(DIALECT_NAMES)('application-verification receipts never reach a %s provider', (dialect) => {
    beforeEach(async () => {
        selectHostedDialect(dialect);
        const actual = await vi.importActual<
            typeof import('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls')
        >('../../repositories/cloudLlm/cloudInference/generateCloudToolCalls');
        backend.generateCloudToolCalls.mockImplementation(actual.generateCloudToolCalls);
    });

    // Red when the explain context starts carrying the run plan's verification receipts as evidence.
    it('keeps every verification receipt id and summary out of an Explain request', async () => {
        const { bodies, heldReceiptIds } = await sendWithVerificationReceipts(EXPLAIN_QUESTION, 'explain');

        expect(heldReceiptIds).toEqual([BASELINE_RECEIPT.callId, PREVIEW_RECEIPT.callId]);
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies.some((body) => body.includes(EXPLAIN_QUESTION))).toBe(true);
        for (const body of bodies) {
            for (const text of FORBIDDEN_TEXTS) {
                expect(body).not.toContain(text);
            }
        }
    });

    // Red when the tool loop's receipt context starts from the run plan's verification receipts.
    it('keeps every verification receipt id and summary out of a tool-loop planning request', async () => {
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });

        const { bodies, heldReceiptIds } = await sendWithVerificationReceipts(PLAN_PROMPT, 'plan');

        expect(heldReceiptIds).toEqual([BASELINE_RECEIPT.callId, PREVIEW_RECEIPT.callId]);
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies.some((body) => body.includes(PLAN_PROMPT))).toBe(true);
        for (const body of bodies) {
            for (const text of FORBIDDEN_TEXTS) {
                expect(body).not.toContain(text);
            }
        }
    });
});
