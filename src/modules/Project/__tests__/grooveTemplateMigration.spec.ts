import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import {
    assignGrooveTemplate,
    createGrooveTemplate,
    getStraightGrooveTemplateId,
    hydrateGrooveTemplates,
} from '#/modules/MIDI/useCases';

import { serializeProjectGrooves } from '../useCases/projectPersistence/fileIO/serializeProjectGrooves';
import { normalizeLegacyProjectData } from '../useCases/projectPersistence/helpers/normalizeLegacyProjectData';

describe('groove template project migration', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('migrates legacy Yeast and Toaster templates once without duplicating equivalent templates', () => {
        const legacy = {
            version: 1,
            meta: {},
            arrangement: {},
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            yeast: {
                grooveTemplates: [{ id: 'yeast-straight', name: 'Straight', offsets: [0, 0] }],
            },
            toaster: {
                grooveTemplates: [
                    { name: 'Straight', offsets: [0, 0] },
                    { name: 'Pocket', offsets: [0, 0.1] },
                ],
            },
        };

        const once = normalizeLegacyProjectData(legacy);
        const twice = normalizeLegacyProjectData(once);

        expect(twice).toEqual(once);
        if (typeof once !== 'object' || once === null || !('grooves' in once)) {
            throw new Error('Expected migrated groove state');
        }
        expect(once.grooves).toEqual(
            expect.objectContaining({
                templates: [
                    expect.objectContaining({ id: getStraightGrooveTemplateId() }),
                    expect.objectContaining({ name: 'Pocket' }),
                ],
                assignments: [],
            })
        );
    });

    it('preserves identity, provenance, lifecycle, and assignments across save/load and replay', () => {
        createGrooveTemplate({
            id: 'saved-pocket',
            name: 'Saved pocket',
            subdivision: '1/16',
            slots: [{ index: 3, timingOffset: -0.1, dynamicsOffset: 0.2 }],
            provenance: { type: 'midi-clip', sourceId: 'clip-source', analyzerVersion: 1 },
        });
        assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: 'processor-1',
            templateId: 'saved-pocket',
            amount: 0.6,
        });
        const saved = serializeProjectGrooves(grooveTemplateStore.value!);

        hydrateGrooveTemplates(structuredClone(defaultGrooveTemplateState));
        hydrateGrooveTemplates(saved);
        expect(serializeProjectGrooves(grooveTemplateStore.value!)).toEqual(saved);

        hydrateGrooveTemplates(structuredClone(saved));
        expect(serializeProjectGrooves(grooveTemplateStore.value!)).toEqual(saved);
    });
});
