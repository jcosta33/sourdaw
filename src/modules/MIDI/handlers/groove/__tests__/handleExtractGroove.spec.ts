import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { createGrooveTemplate } from '../../../useCases/grooveTemplates/createGrooveTemplate';
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

    it('emits no inverse when extraction fails or resolves to Straight', () => {
        const action = createAction('unused-id');

        mocks.notes = [];
        expect(handleExtractGroove.describe(action).inverseAction).toBeNull();
        void handleExtractGroove.execute(action);
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);

        mocks.notes = [
            { id: 'one', startBeat: 0, velocity: 96 },
            { id: 'two', startBeat: 0.25, velocity: 96 },
        ];
        expect(handleExtractGroove.describe(action).inverseAction).toBeNull();
        void handleExtractGroove.execute(action);
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

        expect(handleExtractGroove.describe(createAction('  existing-id  ')).inverseAction).toBeNull();
    });
});
