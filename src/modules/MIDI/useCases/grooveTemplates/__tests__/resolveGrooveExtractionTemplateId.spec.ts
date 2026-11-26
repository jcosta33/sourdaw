import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { createGrooveTemplate } from '../createGrooveTemplate';
import { prepareGrooveExtraction } from '../prepareGrooveExtraction';
import { resolveGrooveExtractionTemplateId } from '../resolveGrooveExtractionTemplateId';

const mocks = vi.hoisted(() => ({
    notes: [] as Array<{ id: string; startBeat: number; velocity: number }>,
}));

vi.mock('../../midiNoteCrud/getNotesForClip', () => ({
    getNotesForClip: () => mocks.notes,
}));

const CLIP_ID = 'clip-source';

function v(suffix: string): string {
    return `groove-${CLIP_ID}-v${suffix}`;
}

function setNotes(startBeat: number): void {
    mocks.notes = [{ id: 'note', startBeat, velocity: 96 }];
}

type StoredTemplate = { id: string; content: 'current' | 'other'; name: string };

function storeTemplate({ id, content, name }: StoredTemplate): void {
    if (content === 'other') {
        createGrooveTemplate({
            id,
            name,
            subdivision: '1/16',
            slots: [{ index: 7, timingOffset: 0.2, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: `other-${id}` },
        });
        return;
    }
    const result = prepareGrooveExtraction({
        clipId: CLIP_ID,
        sourceName: 'Source',
        subdivision: '1/16',
        templateId: id,
    });
    if (result.status !== 'extracted') {
        throw new Error('Expected the current notes to extract a groove');
    }
    createGrooveTemplate({ ...result.template, name });
}

function resolve(subdivision = '1/16') {
    return resolveGrooveExtractionTemplateId({ clipId: CLIP_ID, sourceName: 'Source', subdivision });
}

describe('resolveGrooveExtractionTemplateId', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        setNotes(0.02);
    });

    const extractedRows: Array<{ row: string; stored: StoredTemplate[]; expected: string }> = [
        { row: 'an empty pool', stored: [], expected: v('1') },
        {
            row: 'version 1 holding other content',
            stored: [{ id: v('1'), content: 'other', name: 'Other one' }],
            expected: v('2'),
        },
        {
            row: 'versions 1 and 3 holding other content (the gap is taken)',
            stored: [
                { id: v('1'), content: 'other', name: 'Other one' },
                { id: v('3'), content: 'other', name: 'Other three' },
            ],
            expected: v('2'),
        },
        {
            row: 'versions 1 and 2 holding other content',
            stored: [
                { id: v('1'), content: 'other', name: 'Other one' },
                { id: v('2'), content: 'other', name: 'Other two' },
            ],
            expected: v('3'),
        },
        {
            row: 'version 1 holding the current notes',
            stored: [{ id: v('1'), content: 'current', name: 'Current one' }],
            expected: v('1'),
        },
        {
            row: 'only version 2 holding the current notes, version 1 absent',
            stored: [{ id: v('2'), content: 'current', name: 'Current two' }],
            expected: v('2'),
        },
        {
            row: 'versions 1 and 2 both holding the current notes (the lowest wins)',
            stored: [
                { id: v('2'), content: 'current', name: 'Current two' },
                { id: v('1'), content: 'current', name: 'Current one' },
            ],
            expected: v('1'),
        },
        {
            row: 'version 2 holding the current notes under another name, version 1 other content',
            stored: [
                { id: v('1'), content: 'other', name: 'Other one' },
                { id: v('2'), content: 'current', name: 'A name the extraction would not derive' },
            ],
            expected: v('2'),
        },
        {
            row: 'version 10 holding the current notes beside version 2 holding other content',
            stored: [
                { id: v('10'), content: 'current', name: 'Current ten' },
                { id: v('2'), content: 'other', name: 'Other two' },
            ],
            expected: v('10'),
        },
        {
            row: 'ids that are not versions of this clip, all holding the current notes',
            stored: [
                { id: 'groove-clip-sourcex-v1', content: 'current', name: 'Another clip' },
                { id: v('0'), content: 'current', name: 'Version zero' },
                { id: v('01'), content: 'current', name: 'Version zero one' },
                { id: v('x'), content: 'current', name: 'Version x' },
                { id: v('1-copy'), content: 'current', name: 'Version one copy' },
                { id: `${v('1')}-v1`, content: 'current', name: 'Nested' },
            ],
            expected: v('1'),
        },
        {
            row: 'another clip holding version 1 and this clip holding version 1 with other content',
            stored: [
                { id: 'groove-clip-other-v1', content: 'current', name: 'Other clip one' },
                { id: v('1'), content: 'other', name: 'Other one' },
            ],
            expected: v('2'),
        },
    ];

    it.each(extractedRows)('resolves the id for $row', ({ stored, expected }) => {
        for (const template of stored) {
            storeTemplate(template);
        }
        const before = structuredClone(grooveTemplateStore.value);

        expect(resolve()).toEqual({ status: 'extracted', templateId: expected });
        expect(grooveTemplateStore.value).toEqual(before);
    });

    const notExtractedRows: Array<{ row: string; notes: typeof mocks.notes; subdivision: string }> = [
        { row: 'straight notes', notes: [{ id: 'note', startBeat: 0, velocity: 96 }], subdivision: '1/16' },
        { row: 'no notes', notes: [], subdivision: '1/16' },
        {
            row: 'an unsupported subdivision',
            notes: [{ id: 'note', startBeat: 0.02, velocity: 96 }],
            subdivision: '1/7',
        },
        { row: 'an unreadable note', notes: [{ id: 'note', startBeat: -1, velocity: 96 }], subdivision: '1/16' },
    ];

    it.each(notExtractedRows)('resolves no id for $row, even when version 1 exists', ({ notes, subdivision }) => {
        storeTemplate({ id: v('1'), content: 'other', name: 'Other one' });
        mocks.notes = notes;

        expect(resolve(subdivision)).toEqual({ status: 'not-extracted' });
    });

    it('resolves no id for straight notes with an empty pool', () => {
        mocks.notes = [{ id: 'note', startBeat: 0, velocity: 96 }];

        expect(resolve()).toEqual({ status: 'not-extracted' });
    });
});
