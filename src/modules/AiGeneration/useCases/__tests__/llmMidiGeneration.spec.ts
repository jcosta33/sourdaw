import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateMidiViaLlm } from '../llmMidiGeneration';

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiRuntime/useCases')>();
    return {
        ...actual,
        resolveBackend: () => 'none',
        generateWebLlmCompletion: vi.fn(),
        generateNativeCompletion: vi.fn(),
        isNativeEngineReady: vi.fn(),
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

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
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
});
