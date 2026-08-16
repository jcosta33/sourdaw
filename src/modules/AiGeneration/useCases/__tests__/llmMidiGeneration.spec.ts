import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateMidiViaLlm } from '../llmMidiGeneration';

const mocks = vi.hoisted(() => ({
    generateWebLlmCompletion: vi.fn(),
    resolveBackend: vi.fn(() => 'none'),
    streamCloudChatCompletion: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
    resolveBackend: mocks.resolveBackend,
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../patternQueries/PATTERN_TEMPLATES', () => ({
    PATTERN_TEMPLATES: [
        {
            name: 'Ambient Pad',
            tags: ['ambient'],
            generate: () => [{ pitch: 60, velocity: 100, startBeat: 0, durationBeats: 1 }],
        },
    ],
}));

const notificationEventBus = { emit: vi.fn().mockResolvedValue(undefined) };
const validNotes = JSON.stringify({
    notes: [
        { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
        { pitch: 67, velocity: 72, start_beat: 1, duration_beats: 0.5 },
    ],
});

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: notificationEventBus });
        vi.clearAllMocks();
        mocks.resolveBackend.mockReturnValue('none');
    });

    it('uses the built-in pattern when no retained provider is available', async () => {
        const notes = await generateMidiViaLlm('ambient');

        expect(notes.length).toBeGreaterThan(0);
        expect(mocks.generateWebLlmCompletion).not.toHaveBeenCalled();
        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
    });

    it('accumulates hosted stream tokens into validated MIDI notes', async () => {
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(validNotes.slice(0, 16));
            onToken(validNotes.slice(16));
            return Promise.resolve({ status: 'complete' });
        });

        await expect(generateMidiViaLlm('bassline')).resolves.toEqual([
            { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
            { pitch: 67, velocity: 72, start_beat: 1, duration_beats: 0.5 },
        ]);
        expect(mocks.streamCloudChatCompletion).toHaveBeenCalledOnce();
    });

    it('rejects incomplete hosted output instead of parsing it', async () => {
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.streamCloudChatCompletion.mockImplementation((_messages, onToken) => {
            onToken(validNotes);
            return Promise.resolve({ status: 'incomplete', reason: 'token limit' });
        });

        await expect(generateMidiViaLlm('bassline')).rejects.toThrow(
            'Hosted AI MIDI response was incomplete (token limit).'
        );
    });

    it('uses WebLLM and falls back when its provider payload is malformed', async () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        mocks.generateWebLlmCompletion.mockResolvedValue('{"notes":"not-an-array"}');

        const notes = await generateMidiViaLlm('ambient');

        expect(notes.length).toBeGreaterThan(0);
        expect(mocks.generateWebLlmCompletion).toHaveBeenCalledOnce();
    });
});
