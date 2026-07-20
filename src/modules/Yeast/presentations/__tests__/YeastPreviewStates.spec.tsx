import { describe, expect, it } from 'vitest';

import { createYeastPreviewGeometry } from '../createYeastPreviewCanvasRenderer';
import { createYeastPreviewSummary } from '../createYeastPreviewPresenter';

import { createPreviewEvent } from './yeastPreviewFixtures';

describe('Yeast preview event states', () => {
    it('keeps bypassed events subdued and removes unrealized events at the playhead', () => {
        const frame = createYeastPreviewGeometry({
            events: [
                createPreviewEvent({ eventId: 1, beatTime: 1, bypassed: true }),
                createPreviewEvent({ eventId: 2, beatTime: 0, realized: false, probability: 0.25 }),
                createPreviewEvent({ eventId: 3, beatTime: 2, realized: false, probability: null }),
            ],
            playheadBeat: 0,
            lookaheadBeats: 4,
            width: 400,
            height: 100,
        });

        expect(frame.events.map((event) => event.eventId)).toEqual([1, 3]);
        expect(frame.events[0]).toMatchObject({ tone: 'bypassed' });
        expect(frame.events[0]!.opacity).toBeLessThan(0.5);
    });

    it('labels absent probability honestly without fabricating a percentage', () => {
        const summary = createYeastPreviewSummary([
            createPreviewEvent({ eventId: 1, probability: null }),
            createPreviewEvent({ eventId: 2, probability: 0.5, realized: false }),
        ]);

        expect(summary).toContain('1 non-deterministic');
        expect(summary).not.toContain('100%');
    });
});
