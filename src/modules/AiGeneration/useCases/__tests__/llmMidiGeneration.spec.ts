import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateMidiViaLlm } from '../llmMidiGeneration';

const {
    resolveBackendMock,
    isNativeEngineReadyMock,
    generateNativeCompletionMock,
    generateWebLlmCompletionMock,
    streamCloudChatCompletionMock,
} = vi.hoisted(() => ({
    resolveBackendMock: vi.fn<() => string>(() => 'none'),
    isNativeEngineReadyMock: vi.fn<() => boolean>(() => false),
    generateNativeCompletionMock:
        vi.fn<(systemPrompt: string, userMessage: string, options?: unknown) => Promise<string>>(),
    generateWebLlmCompletionMock:
        vi.fn<(systemPrompt: string, userMessage: string, options?: unknown) => Promise<string>>(),
    streamCloudChatCompletionMock:
        vi.fn<(messages: unknown, onToken: (token: string) => void, options?: unknown) => Promise<void>>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiRuntime/useCases')>();
    return {
        ...actual,
        resolveBackend: resolveBackendMock,
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
        { pitch: 999, velocity: -5, start_beat: -1, duration_beats: 0.001 },
        { pitch: Number.NaN, velocity: 80, start_beat: 0, duration_beats: 1 },
    ],
});

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
        resolveBackendMock.mockReturnValue('none');
        isNativeEngineReadyMock.mockReturnValue(false);
    });

    it('uses pattern fallback when backend resolves to none', async () => {
        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes.length).toBeGreaterThan(0);
        expect(notes[0]).toMatchObject({
            pitch: expect.any(Number),
            velocity: expect.any(Number),
            start_beat: expect.any(Number),
            duration_beats: expect.any(Number),
        });
    });

    it('calls the native completion backend and clamps/filters the parsed notes', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValue(true);
        generateNativeCompletionMock.mockResolvedValue(VALID_NOTES_JSON);

        const notes = await generateMidiViaLlm('a bassline', 16, 0.2);

        expect(generateNativeCompletionMock).toHaveBeenCalledTimes(1);
        // Middle note (pitch 999) is out-of-range and gets clamped; the NaN-pitch note is dropped.
        expect(notes).toEqual([
            { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
            { pitch: 127, velocity: 1, start_beat: 0, duration_beats: 0.0625 },
        ]);
    });

    it('accumulates streamed tokens on the cloud backend into the parsed notes', async () => {
        resolveBackendMock.mockReturnValue('cloud');
        streamCloudChatCompletionMock.mockImplementation(async (_messages, onToken) => {
            onToken(VALID_NOTES_JSON.slice(0, 10));
            onToken(VALID_NOTES_JSON.slice(10));
        });

        const notes = await generateMidiViaLlm('a bassline');

        expect(streamCloudChatCompletionMock).toHaveBeenCalledTimes(1);
        expect(notes[0]).toEqual({ pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 });
    });

    it('falls back to webllm when native is unready, and to the hardcoded default pattern when nothing matches', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValue(false);
        generateWebLlmCompletionMock.mockResolvedValue('not valid json at all');

        const notes = await generateMidiViaLlm('a wholly unrelated prompt', 32, 0.45);

        expect(generateWebLlmCompletionMock).toHaveBeenCalledTimes(1);
        expect(generateNativeCompletionMock).not.toHaveBeenCalled();
        expect(notes).toEqual([
            { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 0.5 },
            { pitch: 64, velocity: 75, start_beat: 0.5, duration_beats: 0.5 },
            { pitch: 67, velocity: 70, start_beat: 1, duration_beats: 0.5 },
            { pitch: 72, velocity: 75, start_beat: 1.5, duration_beats: 0.5 },
            { pitch: 67, velocity: 70, start_beat: 2, duration_beats: 0.5 },
            { pitch: 64, velocity: 75, start_beat: 2.5, duration_beats: 0.5 },
            { pitch: 60, velocity: 80, start_beat: 3, duration_beats: 0.5 },
            { pitch: 64, velocity: 75, start_beat: 3.5, duration_beats: 0.5 },
        ]);
    });

    it('treats a non-array "notes" field as an empty parse and falls back to the pattern match', async () => {
        resolveBackendMock.mockReturnValue('webllm');
        generateWebLlmCompletionMock.mockResolvedValue('{"notes": "not-an-array"}');

        const notes = await generateMidiViaLlm('ambient pad');

        expect(notes.length).toBeGreaterThan(0);
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
