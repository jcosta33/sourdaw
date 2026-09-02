import { describe, expect, it } from 'vitest';

import { DAW_TOOL_SCHEMAS } from '../../ToolDefinitions';
import { markerTools } from '../GenerationAndView';

describe('GenerationAndView tools', () => {
    it('keeps the hidden addNotes command out of the general tool collection', () => {
        expect(DAW_TOOL_SCHEMAS.map((tool) => tool.function.name)).not.toContain('addNotes');
    });

    it('markerTools includes addMarker and addSection', () => {
        const names = markerTools.map((t) => t.function.name);
        expect(names).toContain('addMarker');
        expect(names).toContain('addSection');
    });

    it('all tool names are unique across all arrays', () => {
        const allNames = markerTools.map((t) => t.function.name);
        expect(new Set(allNames).size).toBe(allNames.length);
    });

    it('every tool has a description', () => {
        for (const t of markerTools) {
            expect(t.function.description).toBeTruthy();
        }
    });

    it('every tool has required fields in parameters', () => {
        for (const t of markerTools) {
            expect(Array.isArray(t.function.parameters.required)).toBe(true);
        }
    });
});
