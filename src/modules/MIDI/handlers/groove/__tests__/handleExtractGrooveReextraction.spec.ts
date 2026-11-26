import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { createGrooveTemplate } from '../../../useCases/grooveTemplates/createGrooveTemplate';
import { prepareGrooveExtraction } from '../../../useCases/grooveTemplates/prepareGrooveExtraction';
import { handleExtractGroove } from '../handleExtractGroove';

const mocks = vi.hoisted(() => ({
    notes: [] as Array<{ id: string; startBeat: number; velocity: number }>,
}));

vi.mock('../../../useCases/midiNoteCrud/getNotesForClip', () => ({
    getNotesForClip: () => mocks.notes,
}));

const CLIP_ID = 'clip-source';

function setNotes(startBeat: number): void {
    mocks.notes = [{ id: 'note', startBeat, velocity: 96 }];
}

function createIdLessAction(sourceName = 'Source') {
    return {
        type: 'extractGroove' as const,
        payload: {
            clipId: CLIP_ID,
            sourceName,
            subdivision: '1/16' as const,
            templateId: undefined as string | undefined,
        },
    };
}

/** Describes then executes, as the action pipeline does, and returns the recorded action and its undo. */
function extractIdLess(sourceName?: string) {
    const action = createIdLessAction(sourceName);
    const description = handleExtractGroove.describe(action);
    const result = handleExtractGroove.execute(action);
    return { action, description, result };
}

function storedTemplates() {
    return (grooveTemplateStore.value?.templates ?? []).filter((template) =>
        template.id.startsWith(`groove-${CLIP_ID}-`)
    );
}

function extractCurrentNotes() {
    const result = prepareGrooveExtraction({
        clipId: CLIP_ID,
        sourceName: 'Source',
        subdivision: '1/16',
        templateId: `groove-${CLIP_ID}-v1`,
    });
    if (result.status !== 'extracted') {
        throw new Error('Expected the current notes to extract a groove');
    }
    return result;
}

function currentSourceRevision(): string {
    return extractCurrentNotes().sourceRevision;
}

/** Stores the clip's version 1 holding what the current notes extract to, under a name the extraction would not derive. */
function storeCurrentExtractionAs(name: string) {
    const template = { ...extractCurrentNotes().template, name };
    createGrooveTemplate(template);
    return template;
}

describe('handleExtractGroove re-extraction', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('gives a second extraction after the notes were edited its own template and leaves the first unchanged', () => {
        setNotes(0.02);
        const first = extractIdLess();
        const firstTemplate = structuredClone(storedTemplates()[0]);

        setNotes(0.06);
        const second = extractIdLess();

        expect(first.result).toMatchObject({ status: 'written' });
        expect(second.result).toMatchObject({ status: 'written' });
        expect(storedTemplates().map((template) => template.id)).toEqual([
            `groove-${CLIP_ID}-v1`,
            `groove-${CLIP_ID}-v2`,
        ]);
        expect(storedTemplates()[0]).toEqual(firstTemplate);
        expect(second.action.payload.templateId).toBe(`groove-${CLIP_ID}-v2`);
    });

    it('reuses the identical pinned template when nothing changed between two extractions', () => {
        setNotes(0.02);
        extractIdLess();
        const before = structuredClone(grooveTemplateStore.value);

        const second = createIdLessAction();
        expect(handleExtractGroove.isNoop?.(second)).toBe(true);
        expect(handleExtractGroove.describe(second).inverseAction).toBeNull();
        expect(handleExtractGroove.execute(second)).toEqual({ status: 'no-write' });
        expect(grooveTemplateStore.value).toEqual(before);
    });

    it('reuses the version holding the same notes under another name, writing nothing', () => {
        setNotes(0.02);
        const stored = storeCurrentExtractionAs('Renamed groove');
        const before = structuredClone(grooveTemplateStore.value);

        const action = createIdLessAction();

        expect(handleExtractGroove.isNoop?.(action)).toBe(true);
        expect(handleExtractGroove.describe(action).inverseAction).toBeNull();
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'no-write' });
        expect(grooveTemplateStore.value).toEqual(before);
        expect(storedTemplates()).toEqual([stored]);
    });

    it('accepts a pinned proposal that is the stored template when only the derived name differs', () => {
        setNotes(0.02);
        const stored = storeCurrentExtractionAs('Renamed groove');
        const before = structuredClone(grooveTemplateStore.value);
        const action = {
            type: 'extractGroove' as const,
            payload: {
                clipId: CLIP_ID,
                sourceName: 'Source',
                subdivision: '1/16' as const,
                templateId: stored.id,
                proposal: structuredClone(stored),
                sourceRevision: currentSourceRevision(),
            },
        };

        expect(handleExtractGroove.isNoop?.(action)).toBe(true);
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'no-write' });
        expect(grooveTemplateStore.value).toEqual(before);
    });

    it('undoes only the second extraction by deleting the second template', () => {
        setNotes(0.02);
        extractIdLess();
        setNotes(0.06);
        const second = extractIdLess();
        const inverse = second.description.inverseAction;

        expect(inverse).toMatchObject({
            type: 'deleteGrooveTemplate',
            payload: { templateId: `groove-${CLIP_ID}-v2` },
        });
        expect(inverse?.payload).toEqual({
            templateId: `groove-${CLIP_ID}-v2`,
            expectedTemplate: storedTemplates()[1],
        });
    });

    it('takes the lowest free version when the clip versions have a gap', () => {
        for (const version of [1, 3]) {
            createGrooveTemplate({
                id: `groove-${CLIP_ID}-v${version}`,
                name: `Other groove ${version}`,
                subdivision: '1/16',
                slots: [{ index: version, timingOffset: 0.1, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: `other-${version}` },
            });
        }
        const before = structuredClone(storedTemplates());
        setNotes(0.02);

        const extraction = extractIdLess();

        expect(extraction.result).toMatchObject({ status: 'written' });
        expect(extraction.action.payload.templateId).toBe(`groove-${CLIP_ID}-v2`);
        expect(
            storedTemplates()
                .map((template) => template.id)
                .toSorted()
        ).toEqual([`groove-${CLIP_ID}-v1`, `groove-${CLIP_ID}-v2`, `groove-${CLIP_ID}-v3`]);
        expect(storedTemplates().filter((template) => template.id !== `groove-${CLIP_ID}-v2`)).toEqual(before);
    });

    it('still refuses a different template already holding the id the action carries', () => {
        setNotes(0.02);
        extractIdLess();
        setNotes(0.06);

        const action = {
            type: 'extractGroove' as const,
            payload: {
                clipId: CLIP_ID,
                sourceName: 'Source',
                subdivision: '1/16' as const,
                templateId: `groove-${CLIP_ID}-v1`,
            },
        };

        expect(handleExtractGroove.execute(action)).toEqual({
            status: 'conflict',
            reason: 'template-identity-conflict',
        });
    });
});
