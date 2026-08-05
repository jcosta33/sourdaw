import { describe, expect, it } from 'vitest';

import { type GrooveTemplateState } from '../../../models/GrooveTemplateState';
import { defaultGrooveTemplateState } from '../../../models/GrooveTemplateState';
import { getGrooveProjection } from '../getGrooveProjection';

type TestEvent = { id: string; startBeat: number; duration: number; velocity: number };

function event(id: string, startBeat: number, duration: number, velocity = 100): TestEvent {
    return { id, startBeat, duration, velocity };
}

// swing-light builtin: slot 1 has timingOffset +0.12, dynamicsOffset -0.3
const stateWithSwingAssignment: GrooveTemplateState = {
    templates: defaultGrooveTemplateState.templates,
    assignments: [
        {
            consumerType: 'clip',
            consumerId: 'clip-1',
            templateId: 'swing-light',
            amount: 1,
        },
    ],
};

const stateWithMissingTemplate: GrooveTemplateState = {
    templates: defaultGrooveTemplateState.templates,
    assignments: [
        {
            consumerType: 'clip',
            consumerId: 'clip-1',
            templateId: 'nonexistent',
            amount: 1,
        },
    ],
};

describe('getGrooveProjection — memoization', () => {
    it('returns the same projection object for the same state reference', () => {
        const a = getGrooveProjection(defaultGrooveTemplateState);
        const b = getGrooveProjection(defaultGrooveTemplateState);
        expect(a).toBe(b);
    });

    it('returns a different projection object for a different state reference', () => {
        const a = getGrooveProjection(defaultGrooveTemplateState);
        const b = getGrooveProjection(stateWithSwingAssignment);
        expect(a).not.toBe(b);
    });
});

describe('getGrooveProjection.projectCommittedGroove', () => {
    it('passes events through unchanged when no assignment matches the consumer', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        const events = [event('a', 0.25, 1)];
        const result = projection.projectCommittedGroove({
            events,
            consumerType: 'clip',
            consumerId: 'clip-1',
        });
        expect(result).toBe(events);
    });

    it('passes events through unchanged when the assignment references a missing template', () => {
        const projection = getGrooveProjection(stateWithMissingTemplate);
        const events = [event('a', 0.25, 1)];
        const result = projection.projectCommittedGroove({
            events,
            consumerType: 'clip',
            consumerId: 'clip-1',
        });
        expect(result).toBe(events);
    });

    it('applies timing and velocity offsets from the matched template', () => {
        const projection = getGrooveProjection(stateWithSwingAssignment);
        // Event at beat 0.25 → nearestStep 1 → slot 1 (swing-light: timing +0.12, dynamics -0.3)
        // startBeat: 0.25 + 0.12*0.25*1 = 0.28
        // velocity: round(100 * (1 + -0.3*1)) = 70
        const result = projection.projectCommittedGroove({
            events: [event('a', 0.25, 1, 100)],
            consumerType: 'clip',
            consumerId: 'clip-1',
        });
        expect(result).toHaveLength(1);
        expect(result[0]?.startBeat).toBeCloseTo(0.28, 5);
        expect(result[0]?.velocity).toBe(70);
    });
});

describe('getGrooveProjection.projectClipMidiEvents', () => {
    it('emits a single segment within clip bounds when no groove is assigned', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        const result = projection.projectClipMidiEvents({
            events: [event('a', 0, 2)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        expect(result).toEqual([event('a', 0, 2)]);
    });

    it('drops events whose relative start beat reaches or exceeds the loop length', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        const result = projection.projectClipMidiEvents({
            events: [event('a', 4, 1), event('b', 3.9, 1)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        // beat 4 ≥ 4 → dropped; beat 3.9 < 4 → kept, but duration clipped to iterationEndBeat (4)
        expect(result).toHaveLength(1);
        expect(result[0]?.startBeat).toBe(3.9);
        expect(result[0]?.duration).toBeCloseTo(0.1, 5);
    });

    it('uses raw startBeat when eventsAreAbsolute is true', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        const result = projection.projectClipMidiEvents({
            events: [event('a', 5, 1)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 8,
            iterationStartBeat: 4,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            eventsAreAbsolute: true,
        });
        // absolute startBeat = 5, within [4, 8] iteration, so kept
        expect(result).toHaveLength(1);
        expect(result[0]?.startBeat).toBe(5);
    });

    it('clips segment start against clipStartBeat boundary', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        // Event at relative beat 0 (absolute = iterationStart + 0 = 2), duration 2.
        // clipStartBeat = 3, so the segment start is clipped from 2 to 3.
        const result = projection.projectClipMidiEvents({
            events: [event('a', 0, 2)],
            clipId: 'clip-1',
            clipStartBeat: 3,
            clipEndBeat: 6,
            iterationStartBeat: 2,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        expect(result).toHaveLength(1);
        expect(result[0]?.startBeat).toBe(3);
        expect(result[0]?.duration).toBe(1);
    });

    it('wraps a long event across the loop boundary producing two ordered segments', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        // Event at relative beat 3 (absolute = 3), duration 4, loopLength = 4.
        // Loop wrap: beat 3 → plays 1 beat to boundary 4, then wraps to beat 0 for 3 beats.
        // Output order: [wrapped segment at beat 0 dur 3, first segment at beat 3 dur 1]
        const result = projection.projectClipMidiEvents({
            events: [event('a', 3, 4)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 8,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            loopEnabled: true,
        });
        expect(result).toHaveLength(2);
        expect(result[0]?.startBeat).toBe(0);
        expect(result[0]?.duration).toBe(3);
        expect(result[1]?.startBeat).toBe(3);
        expect(result[1]?.duration).toBe(1);
    });

    it('emits a zero-duration segment when the event duration is zero and position is valid', () => {
        const projection = getGrooveProjection(defaultGrooveTemplateState);
        const result = projection.projectClipMidiEvents({
            events: [event('a', 1, 0)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        expect(result).toHaveLength(1);
        expect(result[0]?.startBeat).toBe(1);
        expect(result[0]?.duration).toBe(0);
    });

    it('applies clip groove before segmenting when clipGrooveAlreadyApplied is false', () => {
        const projection = getGrooveProjection(stateWithSwingAssignment);
        // Event at beat 0.25 → swing shifts it to 0.28
        const result = projection.projectClipMidiEvents({
            events: [event('a', 0.25, 1)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        expect(result).toHaveLength(1);
        expect(result[0]?.startBeat).toBeCloseTo(0.28, 5);
    });

    it('skips clip groove and segments the raw events when clipGrooveAlreadyApplied is true', () => {
        const projection = getGrooveProjection(stateWithSwingAssignment);
        const result = projection.projectClipMidiEvents({
            events: [event('a', 0.25, 1)],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            clipGrooveAlreadyApplied: true,
        });
        expect(result).toHaveLength(1);
        // No groove shift — startBeat stays at 0.25
        expect(result[0]?.startBeat).toBe(0.25);
    });
});
