import { describe, expect, it } from 'vitest';

import { withoutDeferredTempoRecordingSources } from '../deferredTempoRecordingSources';

const owner = {
    kind: 'clip' as const,
    trackId: 'audio',
    collection: 'active' as const,
    alternativeId: 'main',
    clipId: 'recorded',
};
const fields = ['id', 'startBeat'];

function contextAt(startBeat: number) {
    return {
        tracks: {
            tracks: [{ id: 'audio', activeAlternativeId: 'main', clips: [{ id: 'recorded', startBeat }] }],
        },
    };
}

const sources = [
    {
        owner,
        fields,
        value: { present: true as const, value: { id: 'recorded', startBeat: 3.5 } },
        staged: { present: true as const, value: { id: 'recorded', startBeat: 11.25 } },
    },
];

describe('withoutDeferredTempoRecordingSources', () => {
    it('accepts an owner whose live value is the captured value', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(3.5), sources)).not.toBeNull();
    });

    it('accepts an owner whose live value is the staged value', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(11.25), sources)).not.toBeNull();
    });

    it('refuses an owner whose live value is neither the captured nor the staged value', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(7.75), sources)).toBeNull();
    });
});
