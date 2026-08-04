import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateMidiViaLlm } from '../llmMidiGeneration';

type CloudChatOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };
type InitializedBackend = Awaited<ReturnType<typeof import('#/modules/AiRuntime/useCases').initEngine>>;

const {
    resolveBackendMock,
    initEngineMock,
    isNativeEngineReadyMock,
    generateNativeCompletionMock,
    generateWebLlmCompletionMock,
    streamCloudChatCompletionMock,
} = vi.hoisted(() => ({
    resolveBackendMock: vi.fn<() => string>(() => 'none'),
    initEngineMock: vi.fn<() => Promise<InitializedBackend>>(),
    isNativeEngineReadyMock: vi.fn<() => boolean>(() => false),
    generateNativeCompletionMock:
        vi.fn<(systemPrompt: string, userMessage: string, options?: unknown) => Promise<string>>(),
    generateWebLlmCompletionMock:
        vi.fn<(systemPrompt: string, userMessage: string, options?: unknown) => Promise<string>>(),
    streamCloudChatCompletionMock:
        vi.fn<(messages: unknown, onToken: (token: string) => void, options?: unknown) => Promise<CloudChatOutcome>>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiRuntime/useCases')>();
    return {
        ...actual,
        resolveBackend: resolveBackendMock,
        initEngine: initEngineMock,
        isNativeEngineReady: isNativeEngineReadyMock,
        generateNativeCompletion: generateNativeCompletionMock,
        generateWebLlmCompletion: generateWebLlmCompletionMock,
        streamCloudChatCompletion: streamCloudChatCompletionMock,
    };
});

vi.mock('../patternQueries/filterTemplates', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../patternQueries/filterTemplates')>();
    return {
        filterTemplates: vi.fn((pattern: Parameters<typeof actual.filterTemplates>[0]) =>
            actual.filterTemplates(pattern)
        ),
    };
});

vi.mock('../patternQueries/PATTERN_TEMPLATES', () => ({
    PATTERN_TEMPLATES: [
        {
            name: 'Basic Beat',
            category: 'drum',
            tags: ['ambient pad'],
            resolution: 1,
            generate: () => [{ pitch: 60, velocity: 100, startBeat: 0, durationBeats: 1 }],
        },
    ],
}));

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

const VALID_NOTES_JSON = JSON.stringify({
    notes: [
        { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
        { pitch: 67, velocity: 72, start_beat: 1, duration_beats: 0.5 },
    ],
});

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
        resolveBackendMock.mockReturnValue('none');
        isNativeEngineReadyMock.mockReturnValue(false);
        initEngineMock.mockResolvedValue('native');
        streamCloudChatCompletionMock.mockResolvedValue({ status: 'complete' });
    });

    it('uses pattern fallback when backend resolves to none', async () => {
        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes.length).toBeGreaterThan(0);
        expect(notes[0]).toEqual({
            pitch: 60,
            velocity: 100,
            start_beat: 0,
            duration_beats: 1,
        });
    });

    it('bounds built-in fallback output to the sanitized requested maximum', async () => {
        const notes = await generateMidiViaLlm('no matching built-in pattern', 4);

        expect(notes).toHaveLength(4);
    });

    it('calls the selected native completion backend and accepts its validated notes', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValue(true);
        generateNativeCompletionMock.mockResolvedValue(VALID_NOTES_JSON);

        const notes = await generateMidiViaLlm('a bassline', 16, 0.2);

        expect(generateNativeCompletionMock).toHaveBeenCalledTimes(1);
        expect(notes).toEqual([
            { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
            { pitch: 67, velocity: 72, start_beat: 1, duration_beats: 0.5 },
        ]);
    });

    it('accumulates streamed tokens on the cloud backend into the parsed notes', async () => {
        resolveBackendMock.mockReturnValue('cloud');
        streamCloudChatCompletionMock.mockImplementation((_messages, onToken) => {
            onToken(VALID_NOTES_JSON.slice(0, 10));
            onToken(VALID_NOTES_JSON.slice(10));
            return Promise.resolve({ status: 'complete' });
        });

        const notes = await generateMidiViaLlm('a bassline');

        expect(streamCloudChatCompletionMock).toHaveBeenCalledTimes(1);
        expect(notes[0]).toEqual({ pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 });
    });

    it('rejects incomplete hosted output instead of parsing or falling back', async () => {
        resolveBackendMock.mockReturnValue('cloud');
        streamCloudChatCompletionMock.mockImplementation((_messages, onToken) => {
            onToken(VALID_NOTES_JSON);
            return Promise.resolve({ status: 'incomplete', reason: 'token limit' });
        });

        await expect(generateMidiViaLlm('a bassline')).rejects.toThrow(
            'Hosted AI MIDI response was incomplete (token limit).'
        );
        expect(mockNotificationEventBus.emit).not.toHaveBeenCalled();
    });

    it('initializes the selected native backend before generating', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValueOnce(false).mockReturnValue(true);
        generateNativeCompletionMock.mockResolvedValue(VALID_NOTES_JSON);

        await expect(generateMidiViaLlm('a wholly unrelated prompt', 32, 0.45)).resolves.toHaveLength(2);

        expect(initEngineMock).toHaveBeenCalledOnce();
        expect(generateWebLlmCompletionMock).not.toHaveBeenCalled();
        expect(generateNativeCompletionMock).toHaveBeenCalledOnce();
    });

    it('uses cloud when automatic native initialization selects the configured hosted fallback', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValue(false);
        initEngineMock.mockResolvedValue('cloud');
        streamCloudChatCompletionMock.mockImplementation((_messages, onToken) => {
            onToken(VALID_NOTES_JSON);
            return Promise.resolve({ status: 'complete' });
        });

        await expect(generateMidiViaLlm('a bassline')).resolves.toHaveLength(2);

        expect(initEngineMock).toHaveBeenCalledOnce();
        expect(generateNativeCompletionMock).not.toHaveBeenCalled();
        expect(generateWebLlmCompletionMock).not.toHaveBeenCalled();
        expect(streamCloudChatCompletionMock).toHaveBeenCalledOnce();
    });

    it('does not start WebLLM when backend initialization was cancelled', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValue(false);
        initEngineMock.mockResolvedValue('none');

        await expect(generateMidiViaLlm('a bassline')).rejects.toThrow(
            'AI backend initialization was cancelled before MIDI generation.'
        );

        expect(generateNativeCompletionMock).not.toHaveBeenCalled();
        expect(generateWebLlmCompletionMock).not.toHaveBeenCalled();
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('treats a non-array "notes" field as an empty parse and falls back to the pattern match', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue('{"notes": "not-an-array"}');

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes.length).toBeGreaterThan(0);
    });

    it('rejects the whole provider payload when a note is out of range or carries extra fields', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue(
            JSON.stringify({
                notes: [
                    { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
                    { pitch: 999, velocity: 80, start_beat: 1, duration_beats: 1, hidden: true },
                ],
            })
        );

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes).toEqual([{ pitch: 60, velocity: 100, start_beat: 0, duration_beats: 1 }]);
    });

    it('rejects extra root keys instead of accepting a second provider protocol', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue(
            JSON.stringify({
                notes: [{ pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 }],
                explanation: 'also change the tempo',
            })
        );

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes).toEqual([{ pitch: 60, velocity: 100, start_beat: 0, duration_beats: 1 }]);
    });

    it('rejects provider output above the trusted requested note maximum', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue(
            JSON.stringify({
                notes: Array.from({ length: 5 }, (_, index) => ({
                    pitch: 60,
                    velocity: 80,
                    start_beat: index,
                    duration_beats: 0.5,
                })),
            })
        );

        const notes = await generateMidiViaLlm('ambient pad', 4);

        expect(notes).toEqual([{ pitch: 60, velocity: 100, start_beat: 0, duration_beats: 1 }]);
    });

    it('rejects provider notes beyond the safe generation horizon', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue(
            JSON.stringify({
                notes: [{ pitch: 60, velocity: 80, start_beat: 1024, duration_beats: 0.0625 }],
            })
        );

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes).toEqual([{ pitch: 60, velocity: 100, start_beat: 0, duration_beats: 1 }]);
    });

    it('rejects provider timing whose individually finite fields overflow when combined', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue(
            JSON.stringify({
                notes: [
                    {
                        pitch: 60,
                        velocity: 80,
                        start_beat: Number.MAX_VALUE,
                        duration_beats: Number.MAX_VALUE,
                    },
                ],
            })
        );

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes).toEqual([{ pitch: 60, velocity: 100, start_beat: 0, duration_beats: 1 }]);
    });

    it('returns no notes (and falls back) when the balanced JSON object is syntactically invalid', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue('{"notes": [1,2,]}');

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes.length).toBeGreaterThan(0);
    });

    it('extracts the first balanced "notes" object when the model emits multiple JSON blobs', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        const multiObject = `{"thinking":"about {nested} braces"}\n${VALID_NOTES_JSON}\n{"trailing":"junk"}`;
        generateWebLlmCompletionMock.mockResolvedValue(multiObject);

        const notes = await generateMidiViaLlm('a bassline');

        expect(notes[0]).toEqual({ pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 });
    });
});
