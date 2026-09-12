import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { PATTERN_TEMPLATES as rawPatternTemplates } from '../../services/MidiPatternLibrary';
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

const notificationEventBus = { emit: vi.fn().mockResolvedValue(undefined) };
const validNotes = JSON.stringify({
    notes: [
        { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 1 },
        { pitch: 67, velocity: 72, start_beat: 1, duration_beats: 0.5 },
    ],
});

// The real pattern registry is deterministic (pure theory, no randomness), so
// the fallback tests run against it and observe the params the fallback hands
// to the matched template. Spying on the raw service template covers both
// match paths (library filter and registry scan), which each wrap `generate`
// in their own public adapter. "Scale Run" (id ml-scale) has no scale
// override, so its output pitches expose the admitted key/scale directly.
const D_MAJOR_RUN_PITCH_CLASSES = [1, 2, 4, 6, 7, 9, 11, 1];
const C_MINOR_RUN_PITCH_CLASSES = [0, 2, 3, 5, 7, 8, 10, 0];

function spyOnTemplateGenerate(templateId: string) {
    const template = rawPatternTemplates.find((entry) => entry.id === templateId);
    if (!template) {
        throw new Error(`Expected template ${templateId} in the pattern registry`);
    }
    return vi.spyOn(template, 'generate');
}

describe('generateMidiViaLlm', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: notificationEventBus });
        vi.clearAllMocks();
        mocks.resolveBackend.mockReturnValue('none');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses the built-in pattern when no retained provider is available', async () => {
        const notes = await generateMidiViaLlm('ambient');

        expect(notes.length).toBeGreaterThan(0);
        expect(mocks.generateWebLlmCompletion).not.toHaveBeenCalled();
        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
        expect(notificationEventBus.emit).toHaveBeenCalledWith(
            'ui.notify',
            expect.objectContaining({ level: 'warning', message: expect.stringContaining('built-in pattern') })
        );
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

    it('admits the requested key and scale into the matched built-in template', async () => {
        const generateSpy = spyOnTemplateGenerate('ml-scale');

        const notes = await generateMidiViaLlm('ascending scale in D major');

        expect(generateSpy).toHaveBeenCalledWith({ key: 'D', scale: 'major', density: 5, complexity: 5 });
        expect(notes.map((note) => note.pitch % 12)).toEqual(D_MAJOR_RUN_PITCH_CLASSES);
    });

    it('admits a repeated request in another key and scale', async () => {
        const generateSpy = spyOnTemplateGenerate('ml-scale');

        const notes = await generateMidiViaLlm('ascending scale in C minor');

        expect(generateSpy).toHaveBeenCalledWith({ key: 'C', scale: 'minor', density: 5, complexity: 5 });
        expect(notes.map((note) => note.pitch % 12)).toEqual(C_MINOR_RUN_PITCH_CLASSES);
    });

    it('keeps the built-in defaults when the prompt names no key or scale', async () => {
        const generateSpy = spyOnTemplateGenerate('ml-scale');

        const notes = await generateMidiViaLlm('ascending scale');

        expect(generateSpy).toHaveBeenCalledWith({ key: 'C', scale: 'minor', density: 5, complexity: 5 });
        expect(notes.map((note) => note.pitch % 12)).toEqual(C_MINOR_RUN_PITCH_CLASSES);
    });

    it('preserves the requested key and scale when an unreadable response falls back', async () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        mocks.generateWebLlmCompletion.mockResolvedValue('not json at all');
        const generateSpy = spyOnTemplateGenerate('ml-scale');

        const notes = await generateMidiViaLlm('ascending scale in D major');

        expect(generateSpy).toHaveBeenCalledWith({ key: 'D', scale: 'major', density: 5, complexity: 5 });
        expect(notes.map((note) => note.pitch % 12)).toEqual(D_MAJOR_RUN_PITCH_CLASSES);
    });
});
