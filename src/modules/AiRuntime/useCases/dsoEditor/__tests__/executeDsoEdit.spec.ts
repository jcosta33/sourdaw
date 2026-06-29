import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../../stores/pendingActionConfirmationStore';
import { executeDsoEdit, parseEditPlan } from '../executeDsoEdit';

const mocks = vi.hoisted(() => ({
    dsoBackendAvailable: { value: false },
    backend: { value: 'none' },
    nativeEngineReady: { value: false },
    streamNativeCompletion: vi.fn(),
    resolveDsoNames: vi.fn(() => []),
    validateDsos: vi.fn(() => []),
    executeDsos: vi.fn(async () => ({ summaries: ['Changed track'], failures: [] })),
    transactSnapshot: vi.fn(async (callback: () => Promise<void>) => {
        await callback();
        return { before: new Map(), after: new Map() };
    }),
    commitActionUndoEntry: vi.fn(),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'AI edit' })),
    pushAiActionGroup: vi.fn(),
    appendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    setChatGenerating: vi.fn(),
    llmStatusSet: vi.fn(),
    logEdit: vi.fn(),
}));

vi.mock('../../llmOrchestration/backendResolution/isDsoBackendAvailable', () => ({
    isDsoBackendAvailable: () => mocks.dsoBackendAvailable.value,
}));

vi.mock('../../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => mocks.backend.value,
}));

vi.mock('../../../repositories/nativeEngine/lifecycle', () => ({
    isNativeEngineReady: () => mocks.nativeEngineReady.value,
}));

vi.mock('../../../repositories/nativeEngine/streaming', () => ({
    streamNativeCompletion: mocks.streamNativeCompletion,
}));

vi.mock('../../../repositories/webLlm/engineLifecycle', () => ({
    getActiveModelId: () => 'test-model',
    getLlmEngine: () => null,
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => false,
    tauriInvoke: vi.fn(),
    createChannel: vi.fn(),
}));

vi.mock('../compileDso', () => ({
    resolveDsoNames: mocks.resolveDsoNames,
    validateDsos: mocks.validateDsos,
    executeDsos: mocks.executeDsos,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    transactSnapshot: mocks.transactSnapshot,
}));

vi.mock('#/modules/Command/stores', () => ({
    commitActionUndoEntry: mocks.commitActionUndoEntry,
}));

vi.mock('#/modules/Command/useCases', () => ({
    generateGroupId: mocks.generateGroupId,
}));

vi.mock('../../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: mocks.pushAiActionGroup,
}));

vi.mock('../../../stores/chatStore', () => ({
    appendChatMessage: mocks.appendChatMessage,
    updateChatMessage: mocks.updateChatMessage,
    setChatGenerating: mocks.setChatGenerating,
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: { set: mocks.llmStatusSet },
}));

vi.mock('../serializeLogicalState', () => ({
    serializeLogicalState: () => ({}),
    buildProjectSummary: () => '',
    logEdit: mocks.logEdit,
}));

vi.mock('../dsoPrompt', () => ({
    buildDsoPrompt: () => ({ system: 'system', user: 'user' }),
}));

describe('executeDsoEdit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPendingActionConfirmations();
        mocks.dsoBackendAvailable.value = false;
        mocks.backend.value = 'none';
        mocks.nativeEngineReady.value = false;
        mocks.resolveDsoNames.mockReturnValue([]);
        mocks.validateDsos.mockReturnValue([]);
        mocks.executeDsos.mockResolvedValue({ summaries: ['Changed track'], failures: [] });
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-1', groupLabel: 'AI edit' });
        mocks.transactSnapshot.mockImplementation(async (callback: () => Promise<void>) => {
            await callback();
            return { before: new Map(), after: new Map() };
        });
        mocks.streamNativeCompletion.mockImplementation(
            async (
                _messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void
            ): Promise<void> => {
                onToken(JSON.stringify({ kind: 'edit_plan', moderation: 'allow', intent: 'noop', dsos: [] }));
            }
        );
    });

    it('should return failure when no DSO-capable backend is available', async () => {
        const result = await executeDsoEdit('make it louder');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/DSO-capable backend/);
        expect(result.plan).toBeNull();
    });

    it('should leave destructive DSO plans pending without mutating before confirmation', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.streamNativeCompletion.mockImplementation(
            async (
                _messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void
            ): Promise<void> => {
                onToken(
                    JSON.stringify({
                        kind: 'edit_plan',
                        moderation: 'allow',
                        intent: 'remove drums',
                        dsos: [{ op: 'remove_track', track_id: 'track-1' }],
                    })
                );
            }
        );

        const result = await executeDsoEdit('delete drums');

        expect(result.success).toBe(true);
        expect(result.summaries).toEqual([]);
        expect(mocks.executeDsos).not.toHaveBeenCalled();
        expect(mocks.commitActionUndoEntry).not.toHaveBeenCalled();
        expect(mocks.pushAiActionGroup).not.toHaveBeenCalled();
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                prompt: 'delete drums',
                assistantMessageId: expect.any(String),
                status: 'proposed',
                actionLabels: ['remove track: track-1'],
            }),
        ]);
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                pendingActionConfirmationId: expect.stringMatching(/^dso-confirmation-/),
                pendingActionConfirmationStatus: 'proposed',
                content: expect.stringContaining('requires confirmation'),
            })
        );
    });

    it('should keep non-destructive DSO plans auto-applying immediately', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.executeDsos.mockResolvedValue({ summaries: ['Muted track'], failures: [] });
        mocks.streamNativeCompletion.mockImplementation(
            async (
                _messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void
            ): Promise<void> => {
                onToken(
                    JSON.stringify({
                        kind: 'edit_plan',
                        moderation: 'allow',
                        intent: 'mute drums',
                        dsos: [{ op: 'mute_track', track_id: 'track-1', muted: true }],
                    })
                );
            }
        );

        const result = await executeDsoEdit('mute drums');

        expect(result.success).toBe(true);
        expect(result.summaries).toEqual(['Muted track']);
        expect(mocks.executeDsos).toHaveBeenCalledWith([{ op: 'mute_track', track_id: 'track-1', muted: true }]);
        expect(mocks.commitActionUndoEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                label: 'AI: mute drums',
                source: 'ai',
                groupId: 'group-1',
            })
        );
        expect(mocks.pushAiActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'mute drums',
                actions: [{ kind: 'jsonEdit', label: 'Muted track' }],
                groupId: 'group-1',
            })
        );
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
    });
});

describe('parseEditPlan', () => {
    it('parses a well-formed EditPlan directly', () => {
        const plan = parseEditPlan(
            JSON.stringify({
                kind: 'edit_plan',
                moderation: 'allow',
                intent: 'mute drums',
                dsos: [{ op: 'mute_track', track_id: 't1', muted: true }],
            })
        );
        expect(plan.intent).toBe('mute drums');
        expect(plan.dsos).toHaveLength(1);
    });

    it('salvages an EditPlan embedded in prose', () => {
        const raw = `Sure! Here is the plan:\n{"kind":"edit_plan","moderation":"allow","intent":"x","dsos":[]}\nDone.`;
        const plan = parseEditPlan(raw);
        expect(plan.kind).toBe('edit_plan');
        expect(plan.dsos).toEqual([]);
    });

    it('honors braces inside string literals when scanning', () => {
        const raw = `noise {"kind":"edit_plan","moderation":"allow","intent":"name } with brace","dsos":[]} trailing`;
        const plan = parseEditPlan(raw);
        expect(plan.intent).toBe('name } with brace');
    });

    // Fix 2: an object that parses as JSON but is not a valid EditPlan must be
    // rejected — not returned as an EditPlan via an unchecked cast.
    it('rejects a parseable object with an invalid moderation value', () => {
        const raw = JSON.stringify({ kind: 'edit_plan', moderation: 'maybe', intent: 'x', dsos: [] });
        expect(() => parseEditPlan(raw)).toThrow(/moderation/);
    });

    it('rejects a plan whose dsos contain an unknown op', () => {
        const raw = JSON.stringify({
            kind: 'edit_plan',
            moderation: 'allow',
            intent: 'x',
            dsos: [{ op: 'drop_database' }],
        });
        expect(() => parseEditPlan(raw)).toThrow(/unknown "op"/);
    });

    it('rejects a plan whose intent is missing', () => {
        const raw = JSON.stringify({ kind: 'edit_plan', moderation: 'allow', dsos: [] });
        expect(() => parseEditPlan(raw)).toThrow(/intent/);
    });

    it('rejects a dso entry that is not an object', () => {
        const raw = JSON.stringify({ kind: 'edit_plan', moderation: 'allow', intent: 'x', dsos: ['nope'] });
        expect(() => parseEditPlan(raw)).toThrow(/dsos\[0\]/);
    });

    // Fix 1: malformed input that would trigger catastrophic backtracking on the
    // old greedy regex must complete near-instantly with the linear scanner.
    it('does not catastrophically backtrack on adversarial unbalanced input', () => {
        // An opening brace + the trigger token + a very long run with no balanced
        // close. The old /\{[\s\S]*"kind":"edit_plan"[\s\S]*\}/ would backtrack;
        // the brace-balanced scanner walks it once and bails.
        const adversarial = `{${'"kind":"edit_plan",'.repeat(4000)}${'['.repeat(4000)}`;
        const start = performance.now();
        expect(() => parseEditPlan(adversarial)).toThrow();
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(500);
    });

    it('caps the salvage scan at the size limit (oversized input still returns fast)', () => {
        // 5 MB of garbage with a trigger token far past the 16 kB cap.
        const huge = `${'x'.repeat(5_000_000)}{"kind":"edit_plan","moderation":"allow","intent":"x","dsos":[]}`;
        const start = performance.now();
        expect(() => parseEditPlan(huge)).toThrow(/not a valid EditPlan/);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(500);
    });
});
