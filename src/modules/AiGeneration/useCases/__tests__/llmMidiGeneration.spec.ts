import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateMidiViaLlm } from '../llmMidiGeneration';

type CloudChatOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };

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
        vi.fn<(messages: unknown, onToken: (token: string) => void, options?: unknown) => Promise<CloudChatOutcome>>(),
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

    it('does not fall through to WebLLM when the selected native backend is unready', async () => {
        resolveBackendMock.mockReturnValue('native');
        isNativeEngineReadyMock.mockReturnValue(false);

        await expect(generateMidiViaLlm('a wholly unrelated prompt', 32, 0.45)).rejects.toThrow(
            'The selected native AI backend is not ready.'
        );

        expect(generateWebLlmCompletionMock).not.toHaveBeenCalled();
        expect(generateNativeCompletionMock).not.toHaveBeenCalled();
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
