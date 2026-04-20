import { describe, it, expect, vi, beforeEach } from 'vitest';

import { filterTemplates } from '#/modules/AiRuntime/useCases/aiRuntimeQueries/filterTemplates';
import { PATTERN_TEMPLATES } from '#/modules/AiRuntime/useCases/aiRuntimeQueries/PATTERN_TEMPLATES';

import { generateMidiViaLlm } from '../llmMidiGeneration';

vi.mock('#/modules/AiRuntime/useCases', () => ({
    resolveBackend: () => 'none',
    generateWebLlmCompletion: vi.fn(),
    generateNativeCompletion: vi.fn(),
    isNativeEngineReady: vi.fn(),
    filterTemplates: vi.fn((pattern) => filterTemplates(pattern)),
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

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
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
