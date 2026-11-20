import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { createGrooveTemplate } from '../../../useCases/grooveTemplates/createGrooveTemplate';
import { markGrooveTemplateProjectWrite } from '../../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { prepareGrooveExtraction } from '../../../useCases/grooveTemplates/prepareGrooveExtraction';
import { resolveGrooveExtractionTemplateId } from '../../../useCases/grooveTemplates/resolveGrooveExtractionTemplateId';
import { handleDeleteGrooveTemplate } from '../handleDeleteGrooveTemplate';
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

function extractedIds(): string[] {
    return (grooveTemplateStore.value?.templates ?? [])
        .map((template) => template.id)
        .filter((id) => id.startsWith('groove-clip-source-'));
}

describe('handleExtractGroove', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        mocks.notes = [{ id: 'note', startBeat: 0.02, velocity: 96 }];
    });

    it('uses the canonical extracted identity for both inverse planning and execution', () => {
        const action = createAction('  extracted\uFF0Did  ');
        const extracted = getExtractedTemplate();

        expect(handleExtractGroove.describe(action).inverseAction).toEqual({
            type: 'deleteGrooveTemplate',
            payload: { templateId: 'extracted-id', expectedTemplate: extracted.template },
        });
        void handleExtractGroove.execute(action);
        expect(grooveTemplateStore.value?.templates).toContainEqual(extracted.template);
    });

    it('pins the template it will create and the notes it read when it describes the extraction', () => {
        const action = createAction('extracted-id');
        const extracted = getExtractedTemplate();

        handleExtractGroove.describe(action);

        expect(action.payload).toEqual({
            ...createAction('extracted-id').payload,
            proposal: extracted.template,
            sourceRevision: extracted.sourceRevision,
        });
        mocks.notes = [{ id: 'note', startBeat: 0.04, velocity: 96 }];
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'conflict', reason: 'source-revision-mismatch' });
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
        expect(handleExtractGroove.execute(conflicting)).toEqual({
            status: 'conflict',
            reason: 'template-identity-conflict',
        });
    });

    it('rejects a displayed proposal when the source notes changed before commit', () => {
        const action = createProposalAction();
        mocks.notes = [{ id: 'note', startBeat: 0.04, velocity: 96 }];

        expect(handleExtractGroove.execute(action)).toEqual({ status: 'conflict', reason: 'source-revision-mismatch' });
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('rejects a displayed proposal when its source notes were deleted before commit', () => {
        const action = createProposalAction();
        mocks.notes = [];

        expect(handleExtractGroove.execute(action)).toEqual({ status: 'conflict', reason: 'source-revision-mismatch' });
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
        expect(handleExtractGroove.execute(action)).toEqual({
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        });
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

        expect(handleExtractGroove.execute(action)).toEqual({ status: 'conflict', reason: 'proposal-mismatch' });
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
    });

    it('rejects a displayed proposal when source velocity changes before commit', () => {
        const action = createProposalAction();
        mocks.notes = [{ id: 'note', startBeat: 0.02, velocity: 95 }];

        expect(handleExtractGroove.execute(action)).toEqual({ status: 'conflict', reason: 'source-revision-mismatch' });
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
            payload: { templateId: 'collision-id', expectedTemplate: action.payload.proposal },
        });
        expect(handleExtractGroove.execute(action)).toEqual({
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        });
        expect(grooveTemplateStore.value?.templates).toContainEqual(action.payload.proposal);

        expect(handleExtractGroove.isNoop?.(action)).toBe(true);
        expect(handleExtractGroove.execute(action)).toEqual({ status: 'no-write' });
    });
    it('adds a template per extraction with distinct ids, undoing and redoing exactly the pinned one', () => {
        mocks.notes = [
            { id: 'a', startBeat: 0.02, velocity: 96 },
            { id: 'b', startBeat: 0.63, velocity: 80 },
        ];
        const sixteenth = createAction('groove-clip-source-first');
        const eighth = {
            ...createAction('groove-clip-source-second'),
            payload: { ...createAction('groove-clip-source-second').payload, subdivision: '1/8' as const },
        };

        const firstInverse = handleExtractGroove.describe(sixteenth).inverseAction;
        void handleExtractGroove.execute(sixteenth);
        const secondInverse = handleExtractGroove.describe(eighth).inverseAction;
        expect(handleExtractGroove.execute(eighth)).toMatchObject({ status: 'written' });
        expect(extractedIds()).toEqual(['groove-clip-source-first', 'groove-clip-source-second']);
        expect(firstInverse).not.toBeNull();

        if (secondInverse?.type !== 'deleteGrooveTemplate') {
            throw new Error('Expected a deleteGrooveTemplate inverse');
        }
        void handleDeleteGrooveTemplate.execute(secondInverse);
        expect(extractedIds()).toEqual(['groove-clip-source-first']);

        expect(handleExtractGroove.execute(eighth)).toMatchObject({ status: 'written' });
        expect(extractedIds()).toEqual(['groove-clip-source-first', 'groove-clip-source-second']);
    });
    describe('without a template id', () => {
        function idLessAction() {
            return createAction(undefined);
        }

        function extractIdLess() {
            const action = idLessAction();
            const { inverseAction } = handleExtractGroove.describe(action);
            void handleExtractGroove.execute(action);
            return { action, inverseAction };
        }

        it('gives a re-extraction after a note change the next free version, and redo recreates it', () => {
            extractIdLess();
            mocks.notes = [{ id: 'note', startBeat: 0.06, velocity: 96 }];
            const second = extractIdLess();

            expect(extractedIds()).toEqual(['groove-clip-source-v1', 'groove-clip-source-v2']);
            expect(second.action.payload.templateId).toBe('groove-clip-source-v2');

            if (second.inverseAction?.type !== 'deleteGrooveTemplate') {
                throw new Error('Expected a deleteGrooveTemplate inverse');
            }
            void handleDeleteGrooveTemplate.execute(second.inverseAction);
            expect(extractedIds()).toEqual(['groove-clip-source-v1']);

            expect(handleExtractGroove.execute(second.action)).toMatchObject({ status: 'written' });
            expect(extractedIds()).toEqual(['groove-clip-source-v1', 'groove-clip-source-v2']);
        });

        it('reuses the existing template when the content is identical', () => {
            extractIdLess();
            const again = idLessAction();

            expect(handleExtractGroove.isNoop?.(again)).toBe(true);
            handleExtractGroove.describe(again);
            expect(again.payload.templateId).toBe('groove-clip-source-v1');
            expect(handleExtractGroove.execute(again)).toEqual({ status: 'no-write' });
            expect(extractedIds()).toEqual(['groove-clip-source-v1']);
        });

        it('treats a retry under the id the resolver names as a no-write, and a changed clip as the next free id', () => {
            const resolve = () =>
                resolveGrooveExtractionTemplateId({ clipId: 'clip-source', sourceName: 'Source', subdivision: '1/16' });
            const firstId = resolve();
            handleExtractGroove.describe(createAction(firstId));
            void handleExtractGroove.execute(createAction(firstId));

            const retry = createAction(resolve());
            expect(retry.payload.templateId).toBe(firstId);
            expect(handleExtractGroove.isNoop?.(retry)).toBe(true);
            expect(handleExtractGroove.execute(retry)).toEqual({ status: 'no-write' });

            mocks.notes = [{ id: 'note', startBeat: 0.06, velocity: 96 }];
            expect(resolve()).toBe('groove-clip-source-v2');
        });

        it('reuses the version that holds the same content when a lower version was deleted', () => {
            for (const startBeat of [0.02, 0.06, 0.1]) {
                mocks.notes = [{ id: 'note', startBeat, velocity: 96 }];
                extractIdLess();
            }
            expect(extractedIds()).toEqual(['groove-clip-source-v1', 'groove-clip-source-v2', 'groove-clip-source-v3']);
            void handleDeleteGrooveTemplate.execute({
                type: 'deleteGrooveTemplate',
                payload: { templateId: 'groove-clip-source-v2' },
            });

            const again = idLessAction();
            expect(handleExtractGroove.isNoop?.(again)).toBe(true);
            handleExtractGroove.describe(again);
            expect(again.payload.templateId).toBe('groove-clip-source-v3');
            expect(handleExtractGroove.execute(again)).toEqual({ status: 'no-write' });
            expect(extractedIds()).toEqual(['groove-clip-source-v1', 'groove-clip-source-v3']);
        });

        it('still refuses an explicit or pinned id that holds the same slots under another name', () => {
            extractIdLess();
            const state = grooveTemplateStore.value;
            if (!state) {
                throw new Error('Expected groove template state');
            }
            grooveTemplateStore.set({
                ...state,
                templates: state.templates.map((template) =>
                    template.id === 'groove-clip-source-v1' ? { ...template, name: 'Collaborator name' } : template
                ),
            });

            const explicit = createAction('groove-clip-source-v1');
            expect(handleExtractGroove.isNoop?.(explicit)).toBe(false);
            expect(handleExtractGroove.execute(explicit)).toEqual({
                status: 'conflict',
                reason: 'template-identity-conflict',
            });

            const pinned = createAction('groove-clip-source-v1');
            pinned.payload = {
                ...pinned.payload,
                proposal: { ...getExtractedTemplate().template, id: 'groove-clip-source-v1' },
                sourceRevision: getExtractedTemplate().sourceRevision,
            };
            expect(handleExtractGroove.execute(pinned)).toMatchObject({ status: 'conflict' });
        });

        it('keeps a pinned reuse of an existing version a no-write on redo', () => {
            for (const startBeat of [0.02, 0.06, 0.1]) {
                mocks.notes = [{ id: 'note', startBeat, velocity: 96 }];
                extractIdLess();
            }
            void handleDeleteGrooveTemplate.execute({
                type: 'deleteGrooveTemplate',
                payload: { templateId: 'groove-clip-source-v2' },
            });
            const again = idLessAction();
            expect(handleExtractGroove.describe(again).inverseAction).toBeNull();

            expect(again.payload.templateId).toBe('groove-clip-source-v3');
            expect(handleExtractGroove.execute(again)).toEqual({ status: 'no-write' });
            expect(extractedIds()).toEqual(['groove-clip-source-v1', 'groove-clip-source-v3']);
        });

        it('still refuses an explicit id that holds other content', () => {
            extractIdLess();
            mocks.notes = [{ id: 'note', startBeat: 0.06, velocity: 96 }];

            expect(handleExtractGroove.execute(createAction('groove-clip-source-v1'))).toEqual({
                status: 'conflict',
                reason: 'template-identity-conflict',
            });
        });
    });
});
