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
            tracks: [
                {
                    id: 'audio',
                    activeAlternativeId: 'main',
                    clips: [
                        { id: 'other', startBeat: 1 },
                        { id: 'recorded', startBeat },
                    ],
                },
                { id: 'second', activeAlternativeId: 'main', clips: [{ id: 'kept', startBeat: 2 }] },
            ],
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

const contextWithoutRecording = {
    tracks: {
        tracks: [
            { id: 'audio', activeAlternativeId: 'main', clips: [{ id: 'other', startBeat: 1 }] },
            { id: 'second', activeAlternativeId: 'main', clips: [{ id: 'kept', startBeat: 2 }] },
        ],
    },
};

describe('withoutDeferredTempoRecordingSources', () => {
    it('accepts an owner whose live value is the captured value', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(3.5), sources)).not.toBeNull();
    });

    it('accepts an owner whose live value is the staged value', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(11.25), sources)).not.toBeNull();
    });

    it('projects an owner whose live value is the captured value to the exact context without it', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(3.5), sources)).toEqual(contextWithoutRecording);
    });

    it('projects an owner whose live value is the staged value to the exact context without it', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(11.25), sources)).toEqual(contextWithoutRecording);
    });

    it('refuses an owner whose live value is neither the captured nor the staged value', () => {
        expect(withoutDeferredTempoRecordingSources(contextAt(7.75), sources)).toBeNull();
    });
});
