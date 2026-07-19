import { describe, expect, it } from 'vitest';

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
    });
});
