import { describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';
import { selectExecutableAppActionToolSchemasForPrompt } from '../selectExecutableAppActionToolSchemasForPrompt';

describe('selectExecutableAppActionToolSchemasForPrompt', () => {
    it('prioritizes every relevant command in a compound bus-routing prompt within the WebLLM limit', () => {
        const selected = selectExecutableAppActionToolSchemasForPrompt({
            toolSchemas: getExecutableAppActionToolSchemas(),
            prompt: 'create a vocal bus and route the vocal tracks with sends',
        });

        expect(selected).toHaveLength(30);
        expect(selected.map((tool) => tool.function.name)).toEqual(
            expect.arrayContaining(['createBus', 'addSend', 'setTrackOutput'])
        );
    });

    it('retains device bypass and track mute for a compound effect request', () => {
        const selected = selectExecutableAppActionToolSchemasForPrompt({
            toolSchemas: getExecutableAppActionToolSchemas(),
            prompt: 'turn the vocal reverb off and mute the backing vocals',
        });

        expect(selected.map((tool) => tool.function.name)).toEqual(
            expect.arrayContaining(['bypassDevice', 'muteTrack'])
        );
    });

    it.each([
        ['invert the MIDI notes', 'invertNotes'],
        ['retrograde the MIDI notes', 'retrogradeNotes'],
        ['quantize MIDI note lengths to 0.25 beats', 'quantizeNoteLengths'],
        ['scale MIDI velocities by 50%', 'scaleAllVelocities'],
        ['set all velocities to 96', 'setAllVelocities'],
    ])('retains %s within the WebLLM tool limit', (prompt, actionType) => {
        const selected = selectExecutableAppActionToolSchemasForPrompt({
            toolSchemas: getExecutableAppActionToolSchemas(),
            prompt,
        });

        expect(selected).toHaveLength(30);
        expect(selected.map((tool) => tool.function.name)).toContain(actionType);
    });

    it('uses stable registry order as the bounded fallback for an unmatched prompt', () => {
        const allTools = getExecutableAppActionToolSchemas();
        const selected = selectExecutableAppActionToolSchemasForPrompt({
            toolSchemas: allTools,
            prompt: 'xyzzy plugh',
        });

        expect(selected.map((tool) => tool.function.name)).toEqual(
            allTools.slice(0, 30).map((tool) => tool.function.name)
        );
    });

    it('preserves an explicit subset that is already within the WebLLM limit', () => {
        const subset = getExecutableAppActionToolSchemas().slice(10, 13);

        expect(
            selectExecutableAppActionToolSchemasForPrompt({
                toolSchemas: subset,
                prompt: 'mute a track',
            })
        ).toEqual(subset);
    });

    it('matches uppercase MIDI terms independently of the browser locale', () => {
        const localeLowerCase = vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(() => {
            throw new Error('locale-sensitive casing must not participate in tool selection');
        });
        const toolSchemas = [
            ...Array.from({ length: 30 }, (_, index) => ({ function: { name: `unrelatedTool${String(index)}` } })),
            { function: { name: 'addMidiNotes' } },
        ];

        try {
            const selected = selectExecutableAppActionToolSchemasForPrompt({
                toolSchemas,
                prompt: 'Generate MIDI',
            });

            expect(selected.map((tool) => tool.function.name)).toContain('addMidiNotes');
        } finally {
            localeLowerCase.mockRestore();
        }
    });

    it('does not multiply repeated descriptor intent terms across phrase variants', () => {
        const addTrack = getExecutableAppActionToolSchemas().find((tool) => tool.function.name === 'addTrack');
        expect(addTrack).toBeDefined();
        const descriptionTerms = [
            'create',
            'alpha',
            'bravo',
            'charlie',
            'delta',
            'echo',
            'foxtrot',
            'golf',
            'hotel',
            'india',
            'juliet',
            'kilo',
            'lima',
            'mike',
            'november',
            'oscar',
            'papa',
            'quebec',
            'romeo',
            'sierra',
        ].join(' ');
        const equallyRelevantTools = Array.from({ length: 30 }, (_, index) => ({
            function: {
                name: `unrelatedTool${String(index)}`,
                description: descriptionTerms,
            },
        }));

        const selected = selectExecutableAppActionToolSchemasForPrompt({
            toolSchemas: [...equallyRelevantTools, addTrack!],
            prompt: descriptionTerms,
        });

        expect(selected.map((tool) => tool.function.name)).not.toContain('addTrack');
    });
});
