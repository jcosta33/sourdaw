import { describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, isGrooveTemplateState, sanitizeGrooveTemplateState } from '#/modules/MIDI/stores';

import { isHydratableProjectData } from '../isHydratableProjectData';

function createProject(grooves: unknown): Record<string, unknown> {
    return {
        version: 1,
        meta: {
            name: 'Groove validation',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        arrangement: { tracks: [] },
        grooves,
    };
}

function createValidGrooves(): typeof defaultGrooveTemplateState {
    return {
        templates: [
            ...structuredClone(defaultGrooveTemplateState.templates),
            {
                id: 'roundtrip-pocket',
                name: 'Roundtrip pocket',
                schemaVersion: 1,
                subdivision: '1/16',
                slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0.2 }],
                provenance: { type: 'user', sourceId: 'roundtrip-source' },
            },
        ],
        assignments: [
            {
                consumerType: 'clip',
                consumerId: 'roundtrip-clip',
                templateId: 'roundtrip-pocket',
                amount: 0.75,
            },
        ],
    };
}

describe('isHydratableProjectData groove invariants', () => {
    it('shares canonical groove invariants and preserves a JSON roundtrip', () => {
        const grooves = createValidGrooves();
        const roundtrip = JSON.parse(JSON.stringify(grooves)) as unknown;

        expect(isGrooveTemplateState(roundtrip)).toBe(true);
        expect(sanitizeGrooveTemplateState(roundtrip)).toEqual(grooves);
        expect(isHydratableProjectData(createProject(roundtrip))).toBe(true);
    });

    it.each([
        {
            name: 'duplicate slots',
            mutate: (grooves: ReturnType<typeof createValidGrooves>) => {
                grooves.templates.at(-1)!.slots.push({ index: 1, timingOffset: 0.2, dynamicsOffset: 0 });
            },
        },
        {
            name: 'empty provenance source ID',
            mutate: (grooves: ReturnType<typeof createValidGrooves>) => {
                grooves.templates.at(-1)!.provenance.sourceId = '';
            },
        },
        {
            name: 'empty assignment consumer ID',
            mutate: (grooves: ReturnType<typeof createValidGrooves>) => {
                grooves.assignments[0]!.consumerId = '';
            },
        },
    ])('rejects $name before hydration can sanitize it', ({ mutate }) => {
        const grooves = createValidGrooves();
        mutate(grooves);

        expect(isGrooveTemplateState(grooves)).toBe(false);
        expect(isHydratableProjectData(createProject(grooves))).toBe(false);
    });
});
