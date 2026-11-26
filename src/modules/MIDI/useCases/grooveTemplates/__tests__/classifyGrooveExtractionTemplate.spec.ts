import { beforeEach, describe, expect, it } from 'vitest';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { classifyGrooveExtractionTemplate } from '../classifyGrooveExtractionTemplate';

const ID = 'groove-clip-source-v1';

function template(overrides: Partial<GrooveTemplate> = {}): GrooveTemplate {
    return {
        id: ID,
        name: 'Source groove',
        schemaVersion: 1,
        subdivision: '1/16',
        slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
        provenance: { type: 'midi-clip', sourceId: 'clip-source', analyzerVersion: 1 },
        ...overrides,
    };
}

const otherSlots: GrooveTemplate['slots'] = [{ index: 2, timingOffset: -0.1, dynamicsOffset: 0 }];

type Row = {
    row: string;
    stored: GrooveTemplate | undefined;
    proposal: GrooveTemplate | undefined;
    idChosenByResolver: boolean;
    expected: ReturnType<typeof classifyGrooveExtractionTemplate>;
};

const renamed = template({ name: 'Renamed groove' });

const rows: Row[] = [
    {
        row: 'an id the pool does not hold',
        stored: undefined,
        proposal: undefined,
        idChosenByResolver: true,
        expected: { outcome: 'create', template: template() },
    },
    {
        row: 'a pinned proposal equal to the extraction on an id the pool does not hold',
        stored: undefined,
        proposal: template(),
        idChosenByResolver: false,
        expected: { outcome: 'create', template: template() },
    },
    {
        row: 'the very template already stored',
        stored: template(),
        proposal: undefined,
        idChosenByResolver: false,
        expected: { outcome: 'identical' },
    },
    {
        row: 'the same content stored under another name, id chosen by the resolver',
        stored: renamed,
        proposal: undefined,
        idChosenByResolver: true,
        expected: { outcome: 'identical' },
    },
    {
        row: 'the same content stored under another name, id named by the caller',
        stored: renamed,
        proposal: undefined,
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'template-identity-conflict' },
    },
    {
        row: 'the same content stored under another name, id pinned by a proposal equal to the extraction',
        stored: renamed,
        proposal: template(),
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'template-identity-conflict' },
    },
    {
        row: 'other content stored, id chosen by the resolver',
        stored: template({ slots: otherSlots }),
        proposal: undefined,
        idChosenByResolver: true,
        expected: { outcome: 'diverged', code: 'template-identity-conflict' },
    },
    {
        row: 'other content stored, id named by the caller',
        stored: template({ slots: otherSlots }),
        proposal: undefined,
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'template-identity-conflict' },
    },
    {
        row: 'a proposal whose content differs from the extraction',
        stored: undefined,
        proposal: template({ slots: otherSlots }),
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'proposal-mismatch' },
    },
    {
        row: 'a proposal differing from the extraction only by name while nothing is stored',
        stored: undefined,
        proposal: renamed,
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'proposal-mismatch' },
    },
    {
        row: 'a proposal differing only by name from a stored template that is not the proposal',
        stored: template({ name: 'Third name' }),
        proposal: renamed,
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'proposal-mismatch' },
    },
    {
        row: 'a proposal pinning the stored template whose derived name moved',
        stored: renamed,
        proposal: structuredClone(renamed),
        idChosenByResolver: false,
        expected: { outcome: 'identical' },
    },
    {
        row: 'a proposal pinning a stored template whose content differs from the extraction',
        stored: template({ slots: otherSlots }),
        proposal: template({ slots: otherSlots }),
        idChosenByResolver: false,
        expected: { outcome: 'diverged', code: 'proposal-mismatch' },
    },
];

describe('classifyGrooveExtractionTemplate', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it.each(rows)('classifies $row', ({ stored, proposal, idChosenByResolver, expected }) => {
        if (stored) {
            grooveTemplateStore.set({ ...structuredClone(defaultGrooveTemplateState), templates: [stored] });
        }

        expect(classifyGrooveExtractionTemplate({ extracted: template(), proposal, idChosenByResolver })).toEqual(
            expected
        );
    });
});
