import { describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, isGrooveTemplateState, sanitizeGrooveTemplateState } from '#/modules/MIDI/stores';

import { isHydratableProjectData } from '../isHydratableProjectData';
import { normalizeLegacyProjectData } from '../normalizeLegacyProjectData';

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

    it('does not coerce malformed current-schema groove data into validity', () => {
        const grooves = createValidGrooves();
        grooves.templates.at(-1)!.slots[0]!.timingOffset = Number.NaN;
        const currentProject = createProject(grooves);

        const normalized = normalizeLegacyProjectData(currentProject);

        expect(normalized).toEqual(currentProject);
        expect(isHydratableProjectData(normalized)).toBe(false);
    });

    it('accepts durable Yeast processor identity and rejects noncanonical IDs', () => {
        const project = {
            ...createProject(createValidGrooves()),
            yeast: {
                processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
                uiLevel: 2,
            },
        };
        expect(isHydratableProjectData(project)).toBe(true);

        project.yeast.processors[0]!.id = ' groove-1 ';
        expect(isHydratableProjectData(project)).toBe(false);
    });
});
