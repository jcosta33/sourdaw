import { describe, it, expect } from 'vitest';

import { interpolateAutomationPointValue } from '#/modules/Automation/useCases';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { interpolateCurveValue } from '../scheduleAutomationOnParam';

/**
 * Conformance sweep (PR #616 review, non-blocking): the offline export
 * scheduler evaluates automation curves through a local replica (model
 * isolation forbids importing Automation's services). Every representative
 * segment shape must agree with the reference implementation — otherwise
 * exports drift from playback curve-by-curve.
 */

type SegmentCase = {
    label: string;
    first: AutomationPoint;
    second: AutomationPoint;
    previous?: AutomationPoint;
    next?: AutomationPoint;
};

function point(beat: number, value: number, overrides: Partial<AutomationPoint> = {}): AutomationPoint {
    return { beat, value, curve: 'linear', tension: 0, ...overrides };
}

const SEGMENTS: SegmentCase[] = [
    { label: 'linear up', first: point(0, 0.2), second: point(4, 0.9) },
    { label: 'linear down', first: point(0, 0.9), second: point(4, 0.1) },
    { label: 'step', first: point(0, 0.3, { curve: 'step' }), second: point(4, 0.8) },
    { label: 'stairs default steps', first: point(0, 0, { curve: 'stairs' }), second: point(4, 1) },
    {
        label: 'stairs 8 steps',
        first: point(0, 0.2, { curve: 'stairs', stairSteps: 8 }),
        second: point(4, 0.8),
    },
    {
        label: 'exponential positive tension',
        first: point(0, 0.1, { curve: 'exponential', tension: 0.7 }),
        second: point(4, 0.9),
    },
    {
        label: 'exponential negative tension',
        first: point(0, 0.1, { curve: 'exponential', tension: -0.6 }),
        second: point(4, 0.9),
    },
    {
        label: 's-curve tension 1',
        first: point(0, 0.2, { curve: 's-curve', tension: 1 }),
        second: point(4, 0.8),
    },
    {
        label: 's-curve tension 0.3',
        first: point(0, 0.2, { curve: 's-curve', tension: 0.3 }),
        second: point(4, 0.8),
    },
    {
        label: 'smooth with neighbours',
        first: point(2, 0.5, { curve: 'smooth' }),
        second: point(6, 0.7),
        previous: point(-2, 0.1),
        next: point(10, 0.2),
    },
    {
        label: 'smooth end-duplicated',
        first: point(2, 0.9, { curve: 'smooth' }),
        second: point(6, 0.1),
    },
    {
        label: 'bezier with control points',
        first: point(0, 0, { curve: 'bezier', cp1: { x: 0.2, y: 0.8 }, cp2: { x: 0.8, y: 0.1 } }),
        second: point(4, 1),
    },
    {
        label: 'bezier default control points',
        first: point(0, 0.3, { curve: 'bezier' }),
        second: point(4, 0.6),
    },
];

const SAMPLE_FRACTIONS = [0, 0.05, 0.13, 0.25, 0.5, 0.66, 0.87, 0.95, 1];

describe('offline curve replica — conformance with Automation reference', () => {
    for (const segment of SEGMENTS) {
        it(`agrees on ${segment.label}`, () => {
            for (const fraction of SAMPLE_FRACTIONS) {
                const beat = segment.first.beat + (segment.second.beat - segment.first.beat) * fraction;
                const reference = interpolateAutomationPointValue({
                    firstPoint: segment.first,
                    secondPoint: segment.second,
                    beat,
                    previousPoint: segment.previous,
                    nextPoint: segment.next,
                });
                const replica = interpolateCurveValue(
                    segment.first,
                    segment.second,
                    beat,
                    segment.previous,
                    segment.next
                );
                expect(replica, `beat ${beat}`).toBeCloseTo(reference, 6);
            }
        });
    }
});
