import { describe, expect, it } from 'vitest';

import { createStraightGrooveTemplate } from '../models/GrooveTemplate';
import { applyGrooveTemplate } from '../useCases/grooveTemplates/applyGrooveTemplate';

const events = [
    { id: 'a', startBeat: 0, velocity: 100, pitch: 60 },
    { id: 'b', startBeat: 0.25, velocity: 80, pitch: 64 },
];

describe('applyGrooveTemplate', () => {
    it('projects timing and dynamics without mutating source events or changing identity/order', () => {
        const sourceSnapshot = structuredClone(events);
        const result = applyGrooveTemplate({
            events,
            amount: 1,
            template: {
                id: 'late',
                name: 'Late',
                schemaVersion: 1,
                subdivision: '1/16',
                slots: [
                    { index: 0, timingOffset: 0.5, dynamicsOffset: 0.1 },
                    { index: 1, timingOffset: -0.25, dynamicsOffset: -0.1 },
                ],
                provenance: { type: 'user', sourceId: 'manual' },
            },
        });

        expect(events).toEqual(sourceSnapshot);
        expect(result.map((event) => event.id)).toEqual(['a', 'b']);
        expect(result[0]).toEqual({ id: 'a', startBeat: 0.125, velocity: 113, pitch: 60 });
        expect(result[1]).toEqual({ id: 'b', startBeat: 0.1875, velocity: 67, pitch: 64 });
    });

    it('makes Straight a bit-for-bit no-op', () => {
        const result = applyGrooveTemplate({ events, amount: 1, template: createStraightGrooveTemplate() });

        expect(result).toBe(events);
    });

    it('normalizes a non-finite amount to a bit-for-bit no-op', () => {
        const result = applyGrooveTemplate({
            events,
            amount: Number.NaN,
            template: {
                id: 'late',
                name: 'Late',
                schemaVersion: 1,
                subdivision: '1/16',
                slots: [{ index: 0, timingOffset: 0.5, dynamicsOffset: 0.1 }],
                provenance: { type: 'user', sourceId: 'manual' },
            },
        });

        expect(result).toBe(events);
    });

    it('keeps negative projected time additive for the consumer to wrap or clip', () => {
        const result = applyGrooveTemplate({
            events: [{ id: 'early', startBeat: 0, velocity: 100 }],
            amount: 1,
            template: {
                id: 'early',
                name: 'Early',
                schemaVersion: 1,
                subdivision: '1/16',
                slots: [{ index: 0, timingOffset: -0.5, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: 'negative-time-test' },
            },
        });

        expect(result[0]?.startBeat).toBe(-0.125);
    });
});
