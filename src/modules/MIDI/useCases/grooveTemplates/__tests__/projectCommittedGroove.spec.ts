import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { assignGrooveTemplate } from '../assignGrooveTemplate';
import { createGrooveTemplate } from '../createGrooveTemplate';
import { projectCommittedGroove } from '../projectCommittedGroove';

describe('projectCommittedGroove', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    afterEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('returns events unchanged when no groove state has been loaded yet', () => {
        // Before the project (and its groove store) is hydrated, there is nothing to apply.
        // The projection must be a pass-through so playback still works.
        grooveTemplateStore.set(null);

        const events = [{ id: 'n1', startBeat: 0, velocity: 80, duration: 1 }];
        const projected = projectCommittedGroove({ events, consumerType: 'clip', consumerId: 'clip-a' });

        expect(projected).toBe(events);
    });

    it('returns events unchanged when the consumer has no groove assignment', () => {
        // A consumer with no assigned template should play straight — no timing/velocity change.
        const events = [{ id: 'n1', startBeat: 0, velocity: 80, duration: 1 }];
        const projected = projectCommittedGroove({ events, consumerType: 'clip', consumerId: 'unassigned' });

        expect(projected).toBe(events);
    });

    it('applies the assigned template timing/velocity offsets to the consumer events', () => {
        createGrooveTemplate({
            id: 'swing',
            name: 'Swing',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: 0.5, dynamicsOffset: 0.2 }],
            provenance: { type: 'user', sourceId: 'swing' },
        });
        assignGrooveTemplate({ consumerType: 'clip', consumerId: 'clip-a', templateId: 'swing', amount: 1 });

        const events = [{ id: 'n1', startBeat: 0, velocity: 80, duration: 1 }];
        const projected = projectCommittedGroove({ events, consumerType: 'clip', consumerId: 'clip-a' });

        // With amount 1 and a 0.5 timingOffset on a 1/16 slot (step = 0.25 beats),
        // the note moves +0.125 beats and velocity scales by (1 + 0.2) = 1.2 -> 96.
        expect(projected[0]?.startBeat).toBeCloseTo(0.125, 6);
        expect(projected[0]?.velocity).toBe(96);
    });

    it('reduces the groove effect proportionally to the assignment amount', () => {
        createGrooveTemplate({
            id: 'push',
            name: 'Push',
            subdivision: '1/16',
            // timingOffset is bounded to [-0.5, 0.5] of a step; use 0.4 (legal).
            slots: [{ index: 0, timingOffset: 0.4, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'push' },
        });
        assignGrooveTemplate({ consumerType: 'sequencer', consumerId: 'project', templateId: 'push', amount: 0.5 });

        const events = [{ id: 'n1', startBeat: 0, velocity: 100, duration: 1 }];
        const projected = projectCommittedGroove({ events, consumerType: 'sequencer', consumerId: 'project' });

        // amount 0.5 * timingOffset 0.4 * step 0.25 beats = +0.05 beats. Velocity unchanged
        // (dynamicsOffset 0).
        expect(projected[0]?.startBeat).toBeCloseTo(0.05, 6);
        expect(projected[0]?.velocity).toBe(100);
    });
});
