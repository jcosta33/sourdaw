import { describe, it, expect } from 'vitest';

import { DAW_TOOL_SCHEMAS } from '../../models/ToolDefinitions';
import { type ToolSchema } from '../../models/Tools/Types';
import { selectToolsForPrompt } from '../toolSelector';

describe('toolSelector', () => {
    function createMockSchema(name: string): ToolSchema {
        return {
            type: 'function',
            function: {
                name,
                description: '',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
        };
    }

    // Create a pool of "all tools" combining core tools, keyword tools, and some random ones
    const allTools: ToolSchema[] = [
        // CORE TOOLS
        'addTrack',
        'removeTrack',
        'setTrackGain',
        'setTrackPan',
        'muteTrack',
        'soloTrack',
        'setTempo',
        'togglePlayback',
        // KEYWORD TOOLS
        'duplicateTrack',
        'addNotes',
        'completeMidi',
        'analyzeMix',
        'addDevice',
        'removeDevice',
        'addSend',
        'stemSeparate',
        // RANDOM UNRELATED TOOLS
        'unrelatedTool1',
        'unrelatedTool2',
    ].map(createMockSchema);

    it('always includes core tools that are available', () => {
        const selected = selectToolsForPrompt(allTools, 'do nothing specifically');
        const selectedNames = selected.map((time) => time.function.name);

        expect(selectedNames).toContain('addTrack');
        expect(selectedNames).toContain('setTempo');
        expect(selectedNames).toContain('muteTrack');
        expect(selectedNames).not.toContain('unrelatedTool1');
    });

    it('includes specific tools based on keywords (e.g. midi/notes)', () => {
        const selected = selectToolsForPrompt(allTools, 'make a cool midi melody');
        const selectedNames = selected.map((time) => time.function.name);

        expect(selectedNames).toContain('addNotes');
        expect(selectedNames).toContain('completeMidi');
    });

    it('includes specific tools based on keywords (e.g. mix)', () => {
        const selected = selectToolsForPrompt(allTools, 'balance the mix');
        const selectedNames = selected.map((time) => time.function.name);

        expect(selectedNames).toContain('analyzeMix');
    });

    it('makes every executable automation transform available for automation prompts', () => {
        const selected = selectToolsForPrompt([...DAW_TOOL_SCHEMAS], 'thin and quantize the automation envelope');
        const selectedNames = selected.map((tool) => tool.function.name);

        expect(selectedNames).toEqual(
            expect.arrayContaining([
                'addAutomationLane',
                'addAutomationPoint',
                'setAutomationLaneEnabled',
                'setAutomationMode',
                'scaleAutomation',
                'stretchAutomation',
                'invertAutomation',
                'reverseAutomation',
                'thinAutomation',
                'quantizeAutomation',
            ])
        );
    });

    it('includes specific tools based on keywords (e.g. stems)', () => {
        const selected = selectToolsForPrompt(allTools, 'separate the vocal stem');
        const selectedNames = selected.map((time) => time.function.name);

        expect(selectedNames).toContain('stemSeparate');
    });

    it('caps the total number of returned tools to 30', () => {
        // Create 100 tools matching a keyword
        const massiveTools = Array.from({ length: 100 }, (_, index) => createMockSchema(`addTrack${index}`));
        massiveTools.push(createMockSchema('addTrack')); // Add the trigger core tool

        const selected = selectToolsForPrompt(massiveTools, 'track');
        expect(selected.length).toBeLessThanOrEqual(30);
    });

    // Regression: the selector previously referenced tool names that exist in
    // neither RuntimeActionType nor DAW_TOOL_SCHEMAS (setTimeSignature,
    // addMidiNote, quantizeMidi, transposeMidi, addTempoChange). They never
    // matched a real schema so they were silently dropped — but every keyword/
    // core name still consumed a budget slot in the selection Set, weakening the
    // MAX_TOOLS cap. The compile-time guard is `CORE_TOOLS: ReadonlySet<RuntimeActionType>`;
    // these tests pin the observable behavior against the real schema set.
    it('only ever emits tool names that exist in DAW_TOOL_SCHEMAS', () => {
        const realNames = new Set(DAW_TOOL_SCHEMAS.map((schema) => schema.function.name));

        // Drive the selector across every keyword bucket so every internal name
        // is exercised, then confirm the result is a subset of the real tools.
        const prompts = [
            'do nothing specifically', // core-only path
            'set up tracks for a new song project',
            'make a midi melody, quantize and transpose the notes, add a drum beat',
            'balance the mix gain and pan levels',
            'add a reverb effect and a compressor plugin',
            'change the tempo to be faster',
            'draw an automation envelope fade',
            'arm the track and punch in a take',
            'route a send to a bus with sidechain',
            'add a marker and arrange the song structure',
            'split, trim and duplicate the clip',
            'separate the vocal stem',
            'generate some audio and a chord progression',
            'insert time and delete a range',
            'detect the key and transpose to a new scale',
        ];

        for (const prompt of prompts) {
            const selected = selectToolsForPrompt([...DAW_TOOL_SCHEMAS], prompt);
            for (const schema of selected) {
                expect(realNames.has(schema.function.name)).toBe(true);
            }
        }
    });

    it('fills the no-match fallback path with MAX_TOOLS real tools (no slot wasted on a phantom)', () => {
        // The no-keyword-match path tops the selection up from the keyword
        // buckets until it reaches MAX_TOOLS. A phantom name in a bucket would
        // occupy a Set slot but never survive the schema filter, so the returned
        // count would fall short of the cap. Against the real schemas the result
        // must reach exactly MAX_TOOLS.
        const selected = selectToolsForPrompt([...DAW_TOOL_SCHEMAS], 'xyzzy plugh nothing matches here');
        expect(selected).toHaveLength(30);
    });
});
