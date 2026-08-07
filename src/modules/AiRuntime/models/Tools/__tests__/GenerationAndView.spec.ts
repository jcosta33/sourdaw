import { describe, expect, it } from 'vitest';

import { generationTools, markerTools, timeTools, workspaceTools } from '../GenerationAndView';

describe('GenerationAndView tools', () => {
    it('generationTools is non-empty with valid schema', () => {
        expect(generationTools.length).toBeGreaterThan(0);
        for (const t of generationTools) {
            expect(t.type).toBe('function');
            expect(t.function.name).toBeTruthy();
            expect(t.function.parameters.type).toBe('object');
        }
    });

    it('generationTools includes generateDrumPattern and generateMelody', () => {
        const names = generationTools.map((t) => t.function.name);
        expect(names).toContain('generateDrumPattern');
        expect(names).toContain('generateMelody');
    });

    it('generationTools includes addNotes from createAddNotesToolSchema', () => {
        const names = generationTools.map((t) => t.function.name);
        expect(names).toContain('addNotes');
    });

    it('markerTools includes addMarker and addSection', () => {
        const names = markerTools.map((t) => t.function.name);
        expect(names).toContain('addMarker');
        expect(names).toContain('addSection');
    });

    it('timeTools is non-empty', () => {
        expect(timeTools.length).toBeGreaterThan(0);
    });

    it('workspaceTools is non-empty', () => {
        expect(workspaceTools.length).toBeGreaterThan(0);
    });

    it('all tool names are unique across all arrays', () => {
        const allNames = [
            ...generationTools.map((t) => t.function.name),
            ...markerTools.map((t) => t.function.name),
            ...timeTools.map((t) => t.function.name),
            ...workspaceTools.map((t) => t.function.name),
        ];
        expect(new Set(allNames).size).toBe(allNames.length);
    });

    it('every tool has a description', () => {
        for (const t of [...generationTools, ...markerTools, ...timeTools, ...workspaceTools]) {
            expect(t.function.description).toBeTruthy();
        }
    });

    it('every tool has required fields in parameters', () => {
        for (const t of [...generationTools, ...markerTools, ...timeTools, ...workspaceTools]) {
            expect(Array.isArray(t.function.parameters.required)).toBe(true);
        }
    });
});
