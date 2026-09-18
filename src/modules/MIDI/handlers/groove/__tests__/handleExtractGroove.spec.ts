import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';
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

function createAction(templateId?: string) {
    return {
        type: 'extractGroove' as const,
        payload: {
            clipId: 'clip-source',
            sourceName: 'Source',
            subdivision: '1/16' as const,
            templateId,
        },
    };
}

function createProposalAction(templateId = 'extracted-id', name = 'Source groove') {
    return {
        type: 'extractGroove' as const,
        payload: {
            clipId: 'clip-source',
            sourceName: 'Source',
            subdivision: '1/16' as const,
            templateId,
            proposal: {
                id: templateId,
                name,
                schemaVersion: 1 as const,
                subdivision: '1/16' as const,
                slots: [{ index: 0, timingOffset: 0.08, dynamicsOffset: 0 }],
                provenance: { type: 'midi-clip' as const, sourceId: 'clip-source', analyzerVersion: 1 },
            },
            sourceRevision: JSON.stringify([{ id: 'note', startBeat: 0.02, velocity: 96 }]),
        },
    };
}

function getExtractedTemplate(): Extract<ReturnType<typeof prepareGrooveExtraction>, { status: 'extracted' }> {
    const result = prepareGrooveExtraction({
        clipId: 'clip-source',
        sourceName: 'Source',
        subdivision: '1/16',
        templateId: 'extracted-id',
    });
    if (result.status !== 'extracted') {
        throw new Error('Expected an extracted groove template');
    }
    return result;
}

function reorderExtractedTemplate(template: GrooveTemplate): GrooveTemplate {
    if (template.provenance.type !== 'midi-clip') {
        throw new Error('Expected MIDI clip provenance');
    }
    return {
        provenance: {
            analyzerVersion: template.provenance.analyzerVersion,
            sourceId: template.provenance.sourceId,
            type: template.provenance.type,
        },
        slots: template.slots.map((slot) => ({
            dynamicsOffset: slot.dynamicsOffset,
            timingOffset: slot.timingOffset,
            index: slot.index,
        })),
        subdivision: template.subdivision,
        schemaVersion: template.schemaVersion,
        name: template.name,
        id: template.id,
    };
}

describe('handleExtractGroove', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        mocks.notes = [{ id: 'note', startBeat: 0.02, velocity: 96 }];
    });

    it('uses the canonical extracted identity for both inverse planning and execution', () => {
        const action = createAction('  extracted\uFF0Did  ');

        expect(handleExtractGroove.describe(action).inverseAction).toEqual({
            type: 'deleteGrooveTemplate',
            payload: { templateId: 'extracted-id' },
        });
        void handleExtractGroove.execute(action);
        expect(grooveTemplateStore.value?.templates).toContainEqual(expect.objectContaining({ id: 'extracted-id' }));
    });

    it('propagates typed extraction failure and marks Straight as a true no-write', () => {
        const action = createAction('unused-id');

        mocks.notes = [];
        expect(handleExtractGroove.isNoop?.(action)).toBe(false);
        expect(() => handleExtractGroove.execute(action)).toThrow(
            expect.objectContaining({ code: 'empty-source', name: 'GrooveExtractionActionError' })
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);

        mocks.notes = [
            { id: 'one', startBeat: 0, velocity: 96 },
            { id: 'two', startBeat: 0.25, velocity: 96 },
        ];
        expect(handleExtractGroove.isNoop?.(action)).toBe(true);
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('emits no inverse when the extracted canonical identity already exists', () => {
        createGrooveTemplate({
            id: 'existing-id',
            name: 'Existing',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'existing' },
        });

        const conflicting = createAction('  existing-id  ');
        expect(handleExtractGroove.isNoop?.(conflicting)).toBe(false);
        expect(() => handleExtractGroove.execute(conflicting)).toThrow(
            expect.objectContaining({ code: 'template-identity-conflict', name: 'GrooveExtractionActionError' })
        );
    });

    it('rejects a displayed proposal when the source notes changed before commit', () => {
        const action = createProposalAction();
        mocks.notes = [{ id: 'note', startBeat: 0.04, velocity: 96 }];

        expect(() => handleExtractGroove.execute(action)).toThrow(
            expect.objectContaining({ code: 'source-revision-mismatch', name: 'GrooveExtractionActionError' })
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('rejects a displayed proposal when its source notes were deleted before commit', () => {
        const action = createProposalAction();
        mocks.notes = [];

        expect(() => handleExtractGroove.execute(action)).toThrow(
            expect.objectContaining({ code: 'source-revision-mismatch', name: 'GrooveExtractionActionError' })
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('accepts a producer proposal whose object keys were reordered by projection', () => {
        const extracted = getExtractedTemplate();
        const reorderedProposal = reorderExtractedTemplate(extracted.template);
        const action = {
            ...createProposalAction(),
            payload: {
                ...createProposalAction().payload,
                proposal: reorderedProposal,
                sourceRevision: extracted.sourceRevision,
            },
        };

        expect(JSON.stringify(reorderedProposal)).not.toBe(JSON.stringify(extracted.template));
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'written' });
        expect(grooveTemplateStore.value?.templates).toContainEqual(extracted.template);
    });

    it('treats a reordered existing identity as an unchanged retry', () => {
        const extracted = getExtractedTemplate();
        const reorderedExisting = reorderExtractedTemplate(extracted.template);
        const state = grooveTemplateStore.value;
        if (!state) {
            throw new Error('Expected groove template state');
        }
        grooveTemplateStore.set({ ...state, templates: [...state.templates, reorderedExisting] });
        const action = {
            ...createProposalAction(),
            payload: {
                ...createProposalAction().payload,
                proposal: extracted.template,
                sourceRevision: extracted.sourceRevision,
            },
        };
        const beforeRetry = grooveTemplateStore.value;

        expect(JSON.stringify(reorderedExisting)).not.toBe(JSON.stringify(extracted.template));
        expect(handleExtractGroove.isNoop?.(action)).toBe(true);
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'no-write' });
        expect(grooveTemplateStore.value).toBe(beforeRetry);
        expect(
            grooveTemplateStore.value?.templates.filter((template) => template.id === extracted.template.id)
        ).toHaveLength(1);
    });

    it.each([
        ['name', (template: GrooveTemplate) => ({ ...template, name: 'Stale proposal' })],
        [
            'timing',
            (template: GrooveTemplate) => ({
                ...template,
                slots: template.slots.map((slot, index) =>
                    index === 0 ? { ...slot, timingOffset: slot.timingOffset + 0.01 } : slot
                ),
            }),
        ],
    ])('rejects a proposal with changed %s content', (_field, changeTemplate) => {
        const extracted = getExtractedTemplate();
        const action = {
            ...createProposalAction(),
            payload: {
                ...createProposalAction().payload,
                proposal: changeTemplate(extracted.template),
                sourceRevision: extracted.sourceRevision,
            },
        };

        expect(() => handleExtractGroove.execute(action)).toThrow(
            expect.objectContaining({ code: 'proposal-mismatch', name: 'GrooveExtractionActionError' })
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('rejects a displayed proposal when source velocity changes before commit', () => {
        const action = createProposalAction();
        mocks.notes = [{ id: 'note', startBeat: 0.02, velocity: 95 }];

        expect(() => handleExtractGroove.execute(action)).toThrow(
            expect.objectContaining({ code: 'source-revision-mismatch', name: 'GrooveExtractionActionError' })
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('commits the displayed collision-resolved name and treats an identical retry as a no-write', () => {
        createGrooveTemplate({
            id: 'occupied-name',
            name: 'Source groove',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'occupied-name' },
        });
        const action = createProposalAction('collision-id', 'Source groove 2');

        expect(handleExtractGroove.describe(action).inverseAction).toEqual({
            type: 'deleteGrooveTemplate',
            payload: { templateId: 'collision-id' },
        });
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'written' });
        expect(grooveTemplateStore.value?.templates).toContainEqual(action.payload.proposal);

        expect(handleExtractGroove.isNoop?.(action)).toBe(true);
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'no-write' });
    });
});
