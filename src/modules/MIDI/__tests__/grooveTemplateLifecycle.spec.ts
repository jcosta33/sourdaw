import { beforeEach, describe, expect, it } from 'vitest';

import { handleCreateGrooveTemplate } from '../handlers/groove/handleCreateGrooveTemplate';
import { handleDeleteGrooveTemplate } from '../handlers/groove/handleDeleteGrooveTemplate';
import { handleRenameGrooveTemplate } from '../handlers/groove/handleRenameGrooveTemplate';
import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../models/GrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../stores/grooveTemplateStore';
import { createGrooveTemplate } from '../useCases/grooveTemplates/createGrooveTemplate';
import { hydrateGrooveTemplates } from '../useCases/grooveTemplates/hydrateGrooveTemplates';
import { renameGrooveTemplate } from '../useCases/grooveTemplates/renameGrooveTemplate';

describe('groove template lifecycle', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('keeps lifecycle writes in MIDI and resolves generated-name collisions deterministically', () => {
        const first = createGrooveTemplate({
            id: 'one',
            name: 'Pocket',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'one' },
        });
        const second = createGrooveTemplate({
            id: 'two',
            name: 'Pocket',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'two' },
        });

        expect(first.name).toBe('Pocket');
        expect(second.name).toBe('Pocket 2');
        expect(renameGrooveTemplate({ templateId: second.id, name: 'Pocket' })?.name).toBe('Pocket 2');
    });

    it('resolves name collisions with locale-independent Unicode normalization', () => {
        const decomposed = createGrooveTemplate({
            id: 'decomposed',
            name: 'Cafe\u0301',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'decomposed' },
        });
        const composed = createGrooveTemplate({
            id: 'composed',
            name: 'Caf\u00E9',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'composed' },
        });
        const fullWidth = createGrooveTemplate({
            id: 'full-width',
            name: '\uFF30\uFF2F\uFF23\uFF2B\uFF25\uFF34',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'full-width' },
        });
        const ascii = createGrooveTemplate({
            id: 'ascii',
            name: 'pocket',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'ascii' },
        });

        expect(decomposed.name).toBe('Cafe\u0301');
        expect(composed.name).toBe('Caf\u00E9 2');
        expect(fullWidth.name).toBe('\uFF30\uFF2F\uFF23\uFF2B\uFF25\uFF34');
        expect(ascii.name).toBe('pocket 2');
    });

    it('hydrates lifecycle state while preserving explicit Straight', () => {
        hydrateGrooveTemplates({ templates: [], assignments: [] });

        expect(grooveTemplateStore.value?.templates).toEqual([
            expect.objectContaining({ id: STRAIGHT_GROOVE_TEMPLATE_ID, name: 'Straight' }),
        ]);
    });

    it('sanitizes collaboration name collisions with the lowest available suffix', () => {
        hydrateGrooveTemplates({
            templates: [
                ...defaultGrooveTemplateState.templates,
                {
                    id: 'collision-one',
                    name: 'Pocket',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'user', sourceId: 'one' },
                },
                {
                    id: 'collision-two',
                    name: 'Pocket',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'user', sourceId: 'two' },
                },
            ],
            assignments: [],
        });

        expect(grooveTemplateStore.value?.templates.map((template) => template.name)).toEqual([
            'Straight',
            'Pocket',
            'Pocket 2',
        ]);
    });

    it('routes create and rename lifecycle writes through undoable handlers', () => {
        const createAction = {
            type: 'createGrooveTemplate' as const,
            payload: {
                id: 'handler-groove',
                name: 'Handler groove',
                subdivision: '1/16' as const,
                slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                provenance: { type: 'user' as const, sourceId: 'handler' },
            },
        };
        const createDescription = handleCreateGrooveTemplate.describe(createAction);
        expect(handleCreateGrooveTemplate.undoable).toBe(true);
        expect(createDescription.inverseAction).toEqual({
            type: 'deleteGrooveTemplate',
            payload: { templateId: 'handler-groove' },
        });
        void handleCreateGrooveTemplate.execute(createAction);

        const renameAction = {
            type: 'renameGrooveTemplate' as const,
            payload: { templateId: 'handler-groove', name: 'Renamed groove' },
        };
        const renameDescription = handleRenameGrooveTemplate.describe(renameAction);
        expect(handleRenameGrooveTemplate.undoable).toBe(true);
        void handleRenameGrooveTemplate.execute(renameAction);
        expect(grooveTemplateStore.value?.templates.find((template) => template.id === 'handler-groove')?.name).toBe(
            'Renamed groove'
        );

        if (renameDescription.inverseAction?.type !== 'renameGrooveTemplate') {
            throw new Error('Expected rename inverse');
        }
        void handleRenameGrooveTemplate.execute(renameDescription.inverseAction);
        expect(grooveTemplateStore.value?.templates.find((template) => template.id === 'handler-groove')?.name).toBe(
            'Handler groove'
        );

        if (createDescription.inverseAction?.type !== 'deleteGrooveTemplate') {
            throw new Error('Expected create inverse');
        }
        void handleDeleteGrooveTemplate.execute(createDescription.inverseAction);
        expect(grooveTemplateStore.value?.templates.some((template) => template.id === 'handler-groove')).toBe(false);
    });
});
