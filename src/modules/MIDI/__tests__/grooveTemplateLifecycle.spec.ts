import { beforeEach, describe, expect, it } from 'vitest';

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

    it('hydrates lifecycle state while preserving explicit Straight', () => {
        hydrateGrooveTemplates({ templates: [], assignments: [] });

        expect(grooveTemplateStore.value?.templates).toEqual([
            expect.objectContaining({ id: STRAIGHT_GROOVE_TEMPLATE_ID, name: 'Straight' }),
        ]);
    });
});
