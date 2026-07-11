import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../../stores/pendingActionConfirmationStore';
import { executeDsoEdit } from '../executeDsoEdit';

const mocks = vi.hoisted(() => ({
    dsoBackendAvailable: { value: false },
    backend: { value: 'none' },
    nativeEngineReady: { value: false },
    generateSchemaConstrainedNativeCompletion: vi.fn(),
    streamNativeCompletion: vi.fn(),
    resolveDsoNames: vi.fn(() => []),
    validateDsos: vi.fn(() => []),
    commitDsoEditPlan: vi.fn(async () => ({ summaries: ['Changed track'], failures: [] })),
    appendChatMessage: vi.fn(),
    updateChatMessage: vi.fn(),
    setChatGenerating: vi.fn(),
    llmStatusSet: vi.fn(),
    trackStoreState: {
        value: {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [{ id: 'clip-1', name: 'Chorus', trackId: 'track-1' }],
                    devices: [{ id: 'device-1', name: 'Synth', type: 'builtin-synth' }],
                },
            ],
            selectedTrackId: 'track-1',
        },
    },
}));

vi.mock('../../llmOrchestration/backendResolution/isDsoBackendAvailable', () => ({
    isDsoBackendAvailable: () => mocks.dsoBackendAvailable.value,
}));

vi.mock('../../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => mocks.backend.value,
}));

vi.mock('../../../repositories/nativeEngine/isNativeEngineReady', () => ({
    isNativeEngineReady: () => mocks.nativeEngineReady.value,
}));

vi.mock('../../../repositories/nativeEngine/schemaConstrainedGeneration', () => ({
    generateSchemaConstrainedNativeCompletion: mocks.generateSchemaConstrainedNativeCompletion,
}));

vi.mock('../../../repositories/nativeEngine/streaming', () => ({
    streamNativeCompletion: mocks.streamNativeCompletion,
}));

vi.mock('../../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: () => 'test-model',
}));

vi.mock('../../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: () => null,
}));

vi.mock('../resolveDsoNames', () => ({
    resolveDsoNames: mocks.resolveDsoNames,
}));

vi.mock('../validateDsos', () => ({
    validateDsos: mocks.validateDsos,
}));

vi.mock('../commitDsoEditPlan', () => ({
    commitDsoEditPlan: mocks.commitDsoEditPlan,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreState.value;
        },
    },
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
}));

vi.mock('../buildProjectSummary', () => ({
    buildProjectSummary: () => '',
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
        mocks.generateSchemaConstrainedNativeCompletion.mockResolvedValue(null);
        mocks.resolveDsoNames.mockReturnValue([]);
        mocks.validateDsos.mockReturnValue([]);
        mocks.commitDsoEditPlan.mockResolvedValue({ summaries: ['Changed track'], failures: [] });
        mocks.trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [{ id: 'clip-1', name: 'Chorus', trackId: 'track-1' }],
                    devices: [{ id: 'device-1', name: 'Synth', type: 'builtin-synth' }],
                },
            ],
            selectedTrackId: 'track-1',
        };
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

    it('should prefer repository-owned native schema generation before dev-mode stream fallback', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.generateSchemaConstrainedNativeCompletion.mockResolvedValue(
            JSON.stringify({ kind: 'edit_plan', moderation: 'allow', intent: 'noop', dsos: [] })
        );
        const aborter = new AbortController();

        const result = await executeDsoEdit('make it louder', aborter.signal);

        expect(result.success).toBe(true);
        expect(result.plan?.intent).toBe('noop');
        expect(mocks.generateSchemaConstrainedNativeCompletion).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: 'system',
                userMessage: 'user',
                jsonSchema: expect.stringContaining('"edit_plan"'),
                temperature: 0.1,
                maxTokens: 2048,
                signal: aborter.signal,
                onToken: expect.any(Function),
            })
        );
        expect(mocks.streamNativeCompletion).not.toHaveBeenCalled();
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
        expect(mocks.commitDsoEditPlan).not.toHaveBeenCalled();
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                prompt: 'delete drums',
                assistantMessageId: expect.any(String),
                status: 'proposed',
                actionLabels: ['Remove track "Drums"'],
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

    it('should describe destructive DSO confirmation labels from project metadata', async () => {
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
                        intent: 'remove drums, chorus, and synth',
                        dsos: [
                            { op: 'remove_track', track_id: 'track-1' },
                            { op: 'remove_clip', clip_id: 'clip-1' },
                            { op: 'remove_device', track_id: 'track-1', device_id: 'device-1' },
                        ],
                    })
                );
            }
        );

        const result = await executeDsoEdit('delete destructive targets');

        expect(result.pendingConfirmationId).toEqual(expect.stringMatching(/^dso-confirmation-/));
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                actionLabels: [
                    'Remove track "Drums"',
                    'Remove clip "Chorus"',
                    'Remove device "Synth" on track "Drums"',
                ],
            }),
        ]);
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                content: expect.stringContaining('Intent: remove drums, chorus, and synth'),
            })
        );
    });

    it('should list every DSO in a mixed destructive confirmation without executing before confirmation', async () => {
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
                        intent: 'remove and mute drums',
                        dsos: [
                            { op: 'remove_track', track_id: 'track-1' },
                            { op: 'mute_track', track_id: 'track-1', muted: true },
                        ],
                    })
                );
            }
        );

        const result = await executeDsoEdit('delete drums and mute them first');

        expect(result.success).toBe(true);
        expect(result.summaries).toEqual([]);
        expect(mocks.commitDsoEditPlan).not.toHaveBeenCalled();
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                actionLabels: ['Remove track "Drums"', 'Mute track "Drums"'],
                confirmationTargets: [
                    expect.objectContaining({
                        op: 'remove_track',
                        label: 'Remove track "Drums"',
                    }),
                ],
            }),
        ]);
        expect(mocks.updateChatMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                content: expect.stringContaining('- Mute track "Drums"'),
            })
        );
    });

    it('should disambiguate duplicate destructive track names', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [],
                    devices: [],
                },
                {
                    id: 'track-2',
                    name: 'Drums',
                    clips: [],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
        };
        mocks.streamNativeCompletion.mockImplementation(
            async (
                _messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void
            ): Promise<void> => {
                onToken(
                    JSON.stringify({
                        kind: 'edit_plan',
                        moderation: 'allow',
                        intent: 'remove first drums',
                        dsos: [{ op: 'remove_track', track_id: 'track-1' }],
                    })
                );
            }
        );

        await executeDsoEdit('delete the first drums');

        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                actionLabels: ['Remove track "Drums" (id: track-1)'],
            }),
        ]);
    });

    it('should disambiguate duplicate destructive clip names with track context', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [{ id: 'clip-1', name: 'Chorus', trackId: 'track-1' }],
                    devices: [],
                },
                {
                    id: 'track-2',
                    name: 'Bass',
                    clips: [{ id: 'clip-2', name: 'Chorus', trackId: 'track-2' }],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
        };
        mocks.streamNativeCompletion.mockImplementation(
            async (
                _messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void
            ): Promise<void> => {
                onToken(
                    JSON.stringify({
                        kind: 'edit_plan',
                        moderation: 'allow',
                        intent: 'remove chorus on drums',
                        dsos: [{ op: 'remove_clip', clip_id: 'clip-1' }],
                    })
                );
            }
        );

        await executeDsoEdit('delete chorus on drums');

        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                actionLabels: ['Remove clip "Chorus" on track "Drums"'],
            }),
        ]);
    });

    it('should add a stable suffix when duplicate destructive clip names share a track', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Drums',
                    clips: [
                        { id: 'clip-1', name: 'Chorus', trackId: 'track-1' },
                        { id: 'clip-2', name: 'Chorus', trackId: 'track-1' },
                    ],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
        };
        mocks.streamNativeCompletion.mockImplementation(
            async (
                _messages: Array<{ role: string; content: string }>,
                onToken: (text: string) => void
            ): Promise<void> => {
                onToken(
                    JSON.stringify({
                        kind: 'edit_plan',
                        moderation: 'allow',
                        intent: 'remove first chorus',
                        dsos: [{ op: 'remove_clip', clip_id: 'clip-1' }],
                    })
                );
            }
        );

        await executeDsoEdit('delete the first chorus clip');

        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([
            expect.objectContaining({
                actionLabels: ['Remove clip "Chorus" on track "Drums" (id: clip-1)'],
            }),
        ]);
    });

    it('should keep non-destructive DSO plans auto-applying immediately', async () => {
        mocks.dsoBackendAvailable.value = true;
        mocks.backend.value = 'native';
        mocks.nativeEngineReady.value = true;
        mocks.commitDsoEditPlan.mockResolvedValue({ summaries: ['Muted track'], failures: [] });
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
        expect(mocks.commitDsoEditPlan).toHaveBeenCalledWith({
            plan: expect.objectContaining({
                dsos: [{ op: 'mute_track', track_id: 'track-1', muted: true }],
            }),
            userRequest: 'mute drums',
            assistantMessageId: expect.any(String),
            reasoning: undefined,
        });
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
    });
});
