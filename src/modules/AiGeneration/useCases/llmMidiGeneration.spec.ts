import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { PATTERN_TEMPLATES, filterTemplates } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { generateMidiViaLlm } from './llmMidiGeneration';

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('uses pattern fallback when backend resolves to none', async () => {
        injectDependencies(generateMidiViaLlm, {
            resolveBackend: () => 'none',
            generateWebLlmCompletion: vi.fn(),
            generateNativeCompletion: vi.fn(),
            isNativeEngineReady: vi.fn(),
            filterTemplates,
            patternTemplates: PATTERN_TEMPLATES,
        });

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
