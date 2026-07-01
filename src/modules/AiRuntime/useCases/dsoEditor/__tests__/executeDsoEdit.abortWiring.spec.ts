import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeDsoEdit } from '../executeDsoEdit';

// FIX #10 regression: executeDsoEdit's dev-mode native fallback must thread the
// caller's AbortSignal into streamNativeCompletion so a stopped DSO edit can
// break the SSE loop at the source. Before the fix the call passed no options,
// so options.signal was always undefined and the early-break never fired.

const mocks = vi.hoisted(() => ({
    generateSchemaConstrainedNativeCompletion: vi.fn(),
    streamNativeCompletion: vi.fn(),
}));

// Force the dev-mode native fallback branch of invokeLlm:
//   backend === 'native' && isNativeEngineReady() && schema generation unavailable
vi.mock('../../llmOrchestration/backendResolution/isDsoBackendAvailable', () => ({
    isDsoBackendAvailable: () => true,
}));
vi.mock('../../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'native' as const,
}));
vi.mock('../../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: () => true,
}));

vi.mock('../../../repositories/nativeEngine/schemaConstrainedGeneration', () => ({
    generateSchemaConstrainedNativeCompletion: mocks.generateSchemaConstrainedNativeCompletion,
}));

// The unit under test: capture what the caller passes through.
vi.mock('../../../repositories/nativeEngine/streaming', () => ({
    streamNativeCompletion: mocks.streamNativeCompletion,
}));

// Feed a valid, empty EditPlan so executeDsoEdit reaches a clean early-exit
// (no DSOs to resolve/validate/execute) without touching the store-heavy path.
mocks.streamNativeCompletion.mockImplementation(
    async (_messages: Array<{ role: string; content: string }>, onToken: (text: string) => void): Promise<void> => {
        onToken(JSON.stringify({ kind: 'edit_plan', moderation: 'allow', intent: 'noop', dsos: [] }));
        return Promise.resolve();
    }
);

// Collaborators executeDsoEdit touches before/around the LLM call.
vi.mock('./../serializeLogicalState', () => ({
    serializeLogicalState: () => ({}),
    buildProjectSummary: () => '',
    logEdit: vi.fn(),
}));
vi.mock('./../dsoPrompt', () => ({
    buildDsoPrompt: () => ({ system: 'sys', user: 'usr' }),
}));
vi.mock('../../../stores/chatStore', () => ({
    appendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    setChatGenerating: vi.fn(),
}));
vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: { set: vi.fn() },
}));

describe('executeDsoEdit abort wiring (FIX #10)', () => {
    beforeEach(() => {
        mocks.generateSchemaConstrainedNativeCompletion.mockResolvedValue(null);
        mocks.streamNativeCompletion.mockClear();
    });

    it('threads the caller AbortSignal into streamNativeCompletion', async () => {
        const aborter = new AbortController();

        await executeDsoEdit('make it louder', aborter.signal);

        expect(mocks.streamNativeCompletion).toHaveBeenCalledTimes(1);
        const options = mocks.streamNativeCompletion.mock.calls[0]?.[2] as { signal?: AbortSignal } | undefined;
        expect(options?.signal).toBe(aborter.signal);
    });

    it('passes an undefined signal when the caller supplies none', async () => {
        await executeDsoEdit('make it louder');

        const options = mocks.streamNativeCompletion.mock.calls[0]?.[2] as { signal?: AbortSignal } | undefined;
        expect(options?.signal).toBeUndefined();
    });
});
