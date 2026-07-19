import { describe, expect, it } from 'vitest';

import { STRAIGHT_GROOVE_TEMPLATE_ID } from '#/modules/MIDI/useCases';

import { normalizeLegacyProjectData } from '../useCases/projectPersistence/helpers/normalizeLegacyProjectData';

describe('groove template project migration', () => {
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
        expect(once).toEqual(
            expect.objectContaining({
                grooves: expect.objectContaining({
                    templates: [
                        expect.objectContaining({ id: STRAIGHT_GROOVE_TEMPLATE_ID }),
                        expect.objectContaining({ name: 'Pocket' }),
                    ],
                    assignments: [],
                }),
            })
        );
    });
});
