import { describe, it, expect } from 'vitest';

import { type ToolSchema } from '../../models/tools/types';
import { selectToolsForPrompt } from '../toolSelector';

describe('toolSelector', () => {
    function createMockSchema(name: string): ToolSchema {
        return {
            type: 'function',
            function: {
                name,
                description: '',
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
        const selectedNames = selected.map((t) => t.function.name);

        expect(selectedNames).toContain('addTrack');
        expect(selectedNames).toContain('setTempo');
        expect(selectedNames).toContain('muteTrack');
        expect(selectedNames).not.toContain('unrelatedTool1');
    });

    it('includes specific tools based on keywords (e.g. midi/notes)', () => {
        const selected = selectToolsForPrompt(allTools, 'make a cool midi melody');
        const selectedNames = selected.map((t) => t.function.name);

        expect(selectedNames).toContain('addNotes');
        expect(selectedNames).toContain('completeMidi');
    });

    it('includes specific tools based on keywords (e.g. mix)', () => {
        const selected = selectToolsForPrompt(allTools, 'balance the mix');
        const selectedNames = selected.map((t) => t.function.name);

        expect(selectedNames).toContain('analyzeMix');
    });

    it('includes specific tools based on keywords (e.g. stems)', () => {
        const selected = selectToolsForPrompt(allTools, 'separate the vocal stem');
        const selectedNames = selected.map((t) => t.function.name);

        expect(selectedNames).toContain('stemSeparate');
    });

    it('caps the total number of returned tools to 30', () => {
        // Create 100 tools matching a keyword
        const massiveTools = Array.from({ length: 100 }, (_, i) => createMockSchema(`addTrack${i}`));
        massiveTools.push(createMockSchema('addTrack')); // Add the trigger core tool

        const selected = selectToolsForPrompt(massiveTools, 'track');
        expect(selected.length).toBeLessThanOrEqual(30);
    });
});
