import { describe, expect, it } from 'vitest';

import { createBuiltinGrooveTemplates } from '../models/BuiltinGrooveTemplates';
import {
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    STRAIGHT_GROOVE_TEMPLATE_ID,
    createStraightGrooveTemplate,
    isGrooveTemplate,
} from '../models/GrooveTemplate';

describe('GrooveTemplate schema', () => {
    it('defines a stable, device-neutral Straight identity', () => {
        const straight = createStraightGrooveTemplate();

        expect(straight).toEqual({
            id: STRAIGHT_GROOVE_TEMPLATE_ID,
            name: 'Straight',
            schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'builtin', sourceId: 'straight' },
        });
        expect(isGrooveTemplate(straight)).toBe(true);
        expect(Object.keys(straight)).not.toContain('deviceId');
        expect(Object.keys(straight)).not.toContain('padId');
    });

    it('rejects malformed or device-private templates', () => {
        expect(
            isGrooveTemplate({
                id: 'bad',
                name: 'Bad',
                schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
                subdivision: '1/16',
                slots: [{ index: 0, timingOffset: Number.NaN, dynamicsOffset: 0 }],
                provenance: { type: 'legacy', sourceId: 'bad' },
            })
        ).toBe(false);
        expect(
            isGrooveTemplate({
                ...createStraightGrooveTemplate(),
                deviceId: 'yeast-1',
            })
        ).toBe(false);
        expect(isGrooveTemplate({ ...createStraightGrooveTemplate(), name: 'Fake Straight' })).toBe(false);
        expect(
            isGrooveTemplate({
                id: 'out-of-range',
                name: 'Out of range',
                schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
                subdivision: '1/16',
                slots: [{ index: 16, timingOffset: 0, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: 'bad-slot' },
            })
        ).toBe(false);
    });

    it('preserves the canonical factory catalog identities and normalized feel', () => {
        const builtinTemplates = createBuiltinGrooveTemplates();
        expect(builtinTemplates.map((template) => template.id)).toEqual([
            STRAIGHT_GROOVE_TEMPLATE_ID,
            'swing-light',
            'swing-heavy',
            'mpc-60',
            'sp-1200',
            'tr-808-shuffle',
            'tr-909-swing-58',
            'mpc-swing-54',
            'mpc-swing-62',
            'sp-1200-straight',
            'j-dilla-late-snare',
        ]);
        const legacySemantics = [
            {
                id: 'swing-light',
                offsets: [0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03],
                velocities: [1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7],
            },
            {
                id: 'swing-heavy',
                offsets: [0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08],
                velocities: [1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6],
            },
            {
                id: 'mpc-60',
                offsets: [0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03, 0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03],
                velocities: [1.15, 0.75, 0.9, 0.7, 1.1, 0.75, 0.85, 0.7, 1.15, 0.75, 0.9, 0.7, 1.1, 0.75, 0.85, 0.7],
            },
            {
                id: 'sp-1200',
                offsets: [0, -0.03, 0, -0.01, 0, -0.03, 0, -0.02, 0, -0.03, 0, -0.01, 0, -0.03, 0, -0.02],
                velocities: [1.1, 0.8, 0.95, 0.8, 1.05, 0.8, 0.9, 0.8, 1.1, 0.8, 0.95, 0.8, 1.05, 0.8, 0.9, 0.8],
            },
        ];
        for (const legacy of legacySemantics) {
            const template = builtinTemplates.find((candidate) => candidate.id === legacy.id);
            if (!template) {
                throw new Error(`Missing factory groove ${legacy.id}`);
            }
            const timingOffsets = Array.from(
                { length: 16 },
                (_value, index) => (template.slots.find((slot) => slot.index === index)?.timingOffset ?? 0) * 0.25
            );
            const velocityScales = Array.from(
                { length: 16 },
                (_value, index) => 1 + (template.slots.find((slot) => slot.index === index)?.dynamicsOffset ?? 0)
            );
            expect(timingOffsets).toEqual(legacy.offsets);
            expect(velocityScales).toEqual(legacy.velocities);
        }
        expect(builtinTemplates.every(isGrooveTemplate)).toBe(true);
    });
});
