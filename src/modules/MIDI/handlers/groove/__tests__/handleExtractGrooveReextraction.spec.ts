import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { resolveGrooveExtractionPin } from '../../../useCases/grooveTemplates/resolveGrooveExtractionPin';
import { handleDeleteGrooveTemplate } from '../handleDeleteGrooveTemplate';
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

function extractIdLess(sourceName: string): void {
    const action = {
        type: 'extractGroove' as const,
        payload: { clipId: CLIP_ID, sourceName, subdivision: '1/16' as const },
    };
    handleExtractGroove.describe(action);
    void handleExtractGroove.execute(action);
}

/** The action a caller that names the resolver's id sends: the id, pinned to the stored template on reuse. */
function resolvedAction(sourceName: string, { pinStored }: { pinStored: boolean }) {
    const { templateId, template, extraction } = resolveGrooveExtractionPin({
        clipId: CLIP_ID,
        sourceName,
        subdivision: '1/16',
    });
    const payload = { clipId: CLIP_ID, sourceName, subdivision: '1/16' as const, templateId };
    if (!pinStored || template === undefined) {
        return { type: 'extractGroove' as const, payload };
    }
    return {
        type: 'extractGroove' as const,
        payload: { ...payload, proposal: template, sourceRevision: extraction.sourceRevision },
    };
}

function storedIds(): string[] {
    return (grooveTemplateStore.value?.templates ?? [])
        .map((template) => template.id)
        .filter((id) => id.startsWith(`groove-${CLIP_ID}-`));
}

function expectReuseWithoutWrite(sourceName: string, expectedId: string): void {
    const before = structuredClone(grooveTemplateStore.value);
    const action = resolvedAction(sourceName, { pinStored: true });

    expect(action.payload.templateId).toBe(expectedId);
    expect(handleExtractGroove.isNoop?.(action)).toBe(true);
    expect(handleExtractGroove.describe(action).inverseAction).toBeNull();
    expect(handleExtractGroove.execute(action)).toEqual({ status: 'no-write' });
    expect(grooveTemplateStore.value).toEqual(before);
}

describe('handleExtractGroove re-extraction under the resolver id', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('reuses the surviving version when the lowest one was deleted and the fresh name differs', () => {
        setNotes(0.02);
        extractIdLess('Source');
        setNotes(0.06);
        extractIdLess('Source');
        void handleDeleteGrooveTemplate.execute({
            type: 'deleteGrooveTemplate',
            payload: { templateId: `groove-${CLIP_ID}-v1` },
        });
        expect(storedIds()).toEqual([`groove-${CLIP_ID}-v2`]);

        expectReuseWithoutWrite('Source', `groove-${CLIP_ID}-v2`);
        expect(storedIds()).toEqual([`groove-${CLIP_ID}-v2`]);
    });

    it('reuses the existing version when the clip was renamed and the notes are unchanged', () => {
        setNotes(0.02);
        extractIdLess('Source');

        expectReuseWithoutWrite('Renamed clip', `groove-${CLIP_ID}-v1`);
        expect(storedIds()).toEqual([`groove-${CLIP_ID}-v1`]);
    });

    it('refuses the same id under another name when no stored template is pinned', () => {
        setNotes(0.02);
        extractIdLess('Source');

        const action = resolvedAction('Renamed clip', { pinStored: false });

        expect(handleExtractGroove.execute(action)).toEqual({
            status: 'conflict',
            reason: 'template-identity-conflict',
        });
    });
});
