import { describe, expect, it } from 'vitest';

import { createBuiltinGrooveTemplates } from '../models/BuiltinGrooveTemplates';
import { STRAIGHT_GROOVE_TEMPLATE_ID, isGrooveTemplate } from '../models/GrooveTemplate';
import { extractGrooveTemplate } from '../useCases/grooveTemplates/extractGrooveTemplate';

const sourceNotes = [
    { id: 'n1', startBeat: 0.02, velocity: 96 },
    { id: 'n2', startBeat: 1.02, velocity: 96 },
    { id: 'n3', startBeat: 4.06, velocity: 96 },
];

describe('extractGrooveTemplate', () => {
    it('is deterministic and merges cross-bar slot collisions by mean offset', () => {
        const input = {
            sourceId: 'clip-1',
            sourceName: 'Pocket',
            analyzerVersion: 3,
            subdivision: '1/16' as const,
            templateId: 'groove-pocket',
            notes: sourceNotes,
        };

        const first = extractGrooveTemplate(input);
        const second = extractGrooveTemplate(input);

        expect(first).toEqual(second);
        expect(first.ok).toBe(true);
        if (!first.ok) {
            throw new Error('Expected successful extraction');
        }
        expect(first.template.slots.find((slot) => slot.index === 0)?.timingOffset).toBeCloseTo(0.16);
        expect(first.template.provenance).toEqual({
            type: 'midi-clip',
            sourceId: 'clip-1',
            analyzerVersion: 3,
        });
        expect(isGrooveTemplate(first.template)).toBe(true);
    });

    it('is invariant to source-note permutation under adversarial floating-point cancellation', () => {
        const starts = [
            0.25000747680664065, 0.2480859375, 0.1275, 0.250059814453125, 0.24999626159667968, 0.253828125, 0.18875,
            0.1275,
        ];
        const notes = starts.map((startBeat, index) => ({ id: `note-${index}`, startBeat, velocity: 96 }));
        const input = {
            sourceId: 'permutation',
            sourceName: 'Permutation',
            analyzerVersion: 1,
            subdivision: '1/16' as const,
        };

        const canonical = extractGrooveTemplate({ ...input, notes });
        const permuted = extractGrooveTemplate({ ...input, notes: [...notes].reverse() });

        expect(permuted).toEqual(canonical);
    });

    it.each([STRAIGHT_GROOVE_TEMPLATE_ID, 'straight', 'swing-light'])(
        'never lets caller-supplied identity forge reserved template %s',
        (templateId) => {
            const result = extractGrooveTemplate({
                sourceId: 'forged-template',
                sourceName: 'Forged Template',
                analyzerVersion: 1,
                subdivision: '1/16',
                templateId: `  ${templateId}  `,
                notes: sourceNotes,
            });

            expect(result.ok).toBe(true);
            if (!result.ok) {
                throw new Error('Expected successful extraction');
            }
            expect(createBuiltinGrooveTemplates().map((template) => template.id)).not.toContain(result.template.id);
            expect(result.template.id).toBe('groove-forged-template-v1');
            expect(isGrooveTemplate(result.template)).toBe(true);
        }
    );

    it('normalizes source identity before generating template identity and provenance', () => {
        const result = extractGrooveTemplate({
            sourceId: 'cafe\u0301',
            sourceName: 'Unicode',
            analyzerVersion: 2,
            subdivision: '1/16',
            notes: sourceNotes,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected successful extraction');
        }
        expect(result.template.id).toBe('groove-café-v2');
        expect(result.template.provenance).toEqual({
            type: 'midi-clip',
            sourceId: 'café',
            analyzerVersion: 2,
        });
        expect(isGrooveTemplate(result.template)).toBe(true);
    });

    it.each([
        {
            name: 'empty source ID',
            input: { sourceId: '', sourceName: 'Source', analyzerVersion: 1, notes: sourceNotes },
            reason: 'invalid-source-id',
        },
        {
            name: 'blank source name',
            input: { sourceId: 'source', sourceName: '   ', analyzerVersion: 1, notes: sourceNotes },
            reason: 'invalid-source-name',
        },
        {
            name: 'invalid analyzer version',
            input: { sourceId: 'source', sourceName: 'Source', analyzerVersion: 0, notes: sourceNotes },
            reason: 'invalid-analyzer-version',
        },
        {
            name: 'blank template ID',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                templateId: '   ',
                notes: sourceNotes,
            },
            reason: 'invalid-template-id',
        },
        {
            name: 'blank note ID',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                notes: [{ id: '', startBeat: 0, velocity: 96 }],
            },
            reason: 'invalid-note-id',
        },
        {
            name: 'non-finite note start',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                notes: [{ id: 'note', startBeat: Number.NaN, velocity: 96 }],
            },
            reason: 'invalid-note-start',
        },
        {
            name: 'negative note start',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                notes: [{ id: 'note', startBeat: -0.01, velocity: 96 }],
            },
            reason: 'invalid-note-start',
        },
        {
            name: 'unsafe note start',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                notes: [{ id: 'note', startBeat: Number.MAX_VALUE, velocity: 96 }],
            },
            reason: 'invalid-note-start',
        },
        {
            name: 'non-finite note velocity',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                notes: [{ id: 'note', startBeat: 0, velocity: Number.POSITIVE_INFINITY }],
            },
            reason: 'invalid-note-velocity',
        },
        {
            name: 'out-of-range note velocity',
            input: {
                sourceId: 'source',
                sourceName: 'Source',
                analyzerVersion: 1,
                notes: [{ id: 'note', startBeat: 0, velocity: 128 }],
            },
            reason: 'invalid-note-velocity',
        },
    ])('returns typed invalid-source for $name', ({ input, reason }) => {
        expect(extractGrooveTemplate({ ...input, subdivision: '1/16' })).toEqual({
            ok: false,
            error: { code: 'invalid-source', sourceId: input.sourceId, reason },
        });
    });

    it('returns typed empty and unsupported errors', () => {
        expect(
            extractGrooveTemplate({
                sourceId: 'empty',
                sourceName: 'Empty',
                analyzerVersion: 1,
                subdivision: '1/16',
                notes: [],
            })
        ).toEqual({ ok: false, error: { code: 'empty-source', sourceId: 'empty' } });
        expect(
            extractGrooveTemplate({
                sourceId: 'clip-1',
                sourceName: 'Unsupported',
                analyzerVersion: 1,
                subdivision: '1/64',
                notes: sourceNotes,
            })
        ).toEqual({ ok: false, error: { code: 'unsupported-subdivision', subdivision: '1/64' } });
    });

    it('reduces exactly quantized uniform input to explicit Straight', () => {
        const result = extractGrooveTemplate({
            sourceId: 'quantized',
            sourceName: 'Quantized',
            analyzerVersion: 1,
            subdivision: '1/16',
            notes: [
                { id: 'n1', startBeat: 0, velocity: 100 },
                { id: 'n2', startBeat: 0.25, velocity: 100 },
            ],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected successful extraction');
        }
        expect(result.template.id).toBe(STRAIGHT_GROOVE_TEMPLATE_ID);
        expect(result.template.slots).toEqual([]);
    });
});
