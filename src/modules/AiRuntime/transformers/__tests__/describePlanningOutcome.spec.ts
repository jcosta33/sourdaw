import { describe, expect, it } from 'vitest';

import { describePlanningOutcome } from '../describePlanningOutcome';

describe('describePlanningOutcome', () => {
    it('speaks an answer outcome as its own text, without evidence or an error prefix', () => {
        expect(
            describePlanningOutcome({
                kind: 'answer',
                text: 'The mix peaks at -1.2 dBFS.',
                evidence: [{ callId: 'call-1', toolName: 'analysis.measure', summary: 'Peak -1.2 dBFS.' }],
            })
        ).toBe('The mix peaks at -1.2 dBFS.');
    });

    it.each(['', '  \n '])('has nothing to say for an answer whose text is %j', (text) => {
        expect(describePlanningOutcome({ kind: 'answer', text, evidence: [] })).toBeNull();
    });

    it('surfaces a denied outcome reason verbatim', () => {
        expect(
            describePlanningOutcome({
                kind: 'denied',
                reason: 'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.',
            })
        ).toBe(
            'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
        );
    });
});
