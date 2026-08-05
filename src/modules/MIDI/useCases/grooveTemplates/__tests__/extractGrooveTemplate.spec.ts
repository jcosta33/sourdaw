import { describe, expect, it } from 'vitest';

import { extractGrooveTemplate } from '../extractGrooveTemplate';

function validInput(overrides: Record<string, unknown> = {}) {
    return {
        sourceId: 'clip-1',
        sourceName: 'My Clip',
        analyzerVersion: 1,
        subdivision: '1/16',
        notes: [
            { id: 'n1', startBeat: 0, velocity: 100 },
            { id: 'n2', startBeat: 0.03, velocity: 80 },
        ],
        ...overrides,
    } as Parameters<typeof extractGrooveTemplate>[0];
}

describe('extractGrooveTemplate — validation', () => {
    it('rejects unsupported subdivisions', () => {
        const result = extractGrooveTemplate(validInput({ subdivision: '1/64' }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('unsupported-subdivision');
        }
    });

    it('rejects empty source id', () => {
        const result = extractGrooveTemplate(validInput({ sourceId: '  ' }));
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.code === 'invalid-source') {
            expect(result.error.reason).toBe('invalid-source-id');
        }
    });

    it('rejects empty source name', () => {
        const result = extractGrooveTemplate(validInput({ sourceName: '' }));
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.code === 'invalid-source') {
            expect(result.error.reason).toBe('invalid-source-name');
        }
    });

    it('rejects non-positive analyzer version', () => {
        const result = extractGrooveTemplate(validInput({ analyzerVersion: 0 }));
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.code === 'invalid-source') {
            expect(result.error.reason).toBe('invalid-analyzer-version');
        }
    });

    it('rejects invalid note velocity', () => {
        const result = extractGrooveTemplate(validInput({ notes: [{ id: 'n1', startBeat: 0, velocity: 200 }] }));
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.code === 'invalid-source') {
            expect(result.error.reason).toBe('invalid-note-velocity');
        }
    });
});

describe('extractGrooveTemplate — extraction', () => {
    it('returns empty-source error when notes array is empty', () => {
        const result = extractGrooveTemplate(validInput({ notes: [] }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('empty-source');
        }
    });

    it('returns a straight groove when all notes land exactly on the grid', () => {
        const result = extractGrooveTemplate(
            validInput({
                notes: [
                    { id: 'n1', startBeat: 0, velocity: 100 },
                    { id: 'n2', startBeat: 0.25, velocity: 100 },
                ],
            })
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.template.id).toBe('groove-straight');
            expect(result.template.slots).toEqual([]);
        }
    });

    it('extracts timing and dynamics offsets from off-grid notes', () => {
        const result = extractGrooveTemplate(
            validInput({
                notes: [
                    { id: 'n1', startBeat: 0, velocity: 100 },
                    { id: 'n2', startBeat: 0.28, velocity: 70 },
                ],
            })
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.template.id).not.toBe('groove-straight');
            expect(result.template.slots.length).toBeGreaterThan(0);
            // The off-grid note at 0.28 has timing offset
            const slot1 = result.template.slots.find((s) => s.index === 1);
            expect(slot1).toBeDefined();
            expect(slot1!.timingOffset).toBeGreaterThan(0);
            // Lower velocity → negative dynamics offset
            expect(slot1!.dynamicsOffset).toBeLessThan(0);
        }
    });

    it('includes provenance with midi-clip type and analyzer version', () => {
        const result = extractGrooveTemplate(validInput({ analyzerVersion: 3, sourceId: 'clip-xyz' }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.template.provenance).toEqual({
                type: 'midi-clip',
                sourceId: 'clip-xyz',
                analyzerVersion: 3,
            });
        }
    });

    it('uses the provided templateId when valid and not reserved', () => {
        const result = extractGrooveTemplate(validInput({ templateId: 'my-custom-groove' }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.template.id).toBe('my-custom-groove');
        }
    });

    it('falls back to auto-generated id when templateId is a reserved builtin', () => {
        const result = extractGrooveTemplate(validInput({ templateId: 'groove-straight' }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.template.id).toBe('groove-clip-1-v1');
        }
    });

    it('uses the trimmed source name in the template name', () => {
        const result = extractGrooveTemplate(validInput({ sourceName: '  Funky Beat  ' }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.template.name).toBe('Funky Beat groove');
        }
    });
});
