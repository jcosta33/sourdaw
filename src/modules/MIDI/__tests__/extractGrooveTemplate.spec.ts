import { describe, expect, it } from 'vitest';

import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../models/GrooveTemplate';
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
