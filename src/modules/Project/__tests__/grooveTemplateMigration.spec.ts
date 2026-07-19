import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import {
    assignGrooveTemplate,
    createGrooveTemplate,
    getCanonicalGrooveTemplateKey,
    getStraightGrooveTemplateId,
    hydrateGrooveTemplates,
} from '#/modules/MIDI/useCases';

import { serializeProjectGrooves } from '../useCases/projectPersistence/fileIO/serializeProjectGrooves';
import { normalizeLegacyProjectData } from '../useCases/projectPersistence/helpers/normalizeLegacyProjectData';
import { initProject } from '../useCases/projectTemplates/templateHelpers/initProject';
import { setGroove } from '../useCases/projectTemplates/templateHelpers/setGroove';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
        const grooves = once.grooves;
        if (
            typeof grooves !== 'object' ||
            grooves === null ||
            !('templates' in grooves) ||
            !('assignments' in grooves)
        ) {
            throw new Error('Expected migrated groove collections');
        }
        if (!Array.isArray(grooves.templates)) {
            throw new TypeError('Expected migrated groove templates');
        }
        expect(grooves.assignments).toEqual([]);
        const hasStraight = grooves.templates.some(
            (template: unknown) => isRecord(template) && template.id === getStraightGrooveTemplateId()
        );
        const hasPocket = grooves.templates.some(
            (template: unknown) => isRecord(template) && template.name === 'Pocket'
        );
        expect(hasStraight).toBe(true);
        expect(hasPocket).toBe(true);
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

    it('resets canonical groove truth before each project template and serializes without cross-project leakage', () => {
        createGrooveTemplate({
            id: 'prior-project-groove',
            name: 'Prior project groove',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'prior-project' },
        });
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'prior-project-groove',
            amount: 0.7,
        });

        initProject({ name: 'Next template', bpm: 110 });
        setGroove({
            id: 'next-template-groove',
            name: 'Next template groove',
            offsets: [0, 0.05],
            resolution: 0.25,
            intensity: 0.6,
        });

        const saved = serializeProjectGrooves(grooveTemplateStore.value!);
        expect(grooveTemplateStore.value?.templates.some((template) => template.id === 'prior-project-groove')).toBe(
            false
        );
        expect(saved.templates.map((template) => template.id)).toEqual([
            ...defaultGrooveTemplateState.templates.map((template) => template.id),
            'next-template-groove',
        ]);
        expect(saved.assignments).toEqual([
            {
                consumerType: 'sequencer',
                consumerId: 'project',
                templateId: 'next-template-groove',
                amount: 0.6,
            },
        ]);

        hydrateGrooveTemplates({ templates: [], assignments: [] });
        hydrateGrooveTemplates(saved);
        expect(serializeProjectGrooves(grooveTemplateStore.value!)).toEqual(saved);
    });

    it('migrates names and IDs identically under en-US and tr-TR locale behavior', () => {
        const legacy = {
            version: 1,
            meta: {},
            arrangement: {},
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            yeast: {
                grooveTemplates: [
                    { id: 'I', name: 'I', offsets: [0, 0.1] },
                    { id: 'i', name: 'i', offsets: [0, 0.2] },
                ],
            },
        };
        const localeFixtures = ['en-US', 'tr-TR'] as const;
        expect('I'.toLocaleLowerCase(localeFixtures[0])).not.toBe('I'.toLocaleLowerCase(localeFixtures[1]));
        for (const locale of localeFixtures) {
            expect({ locale, canonicalKey: getCanonicalGrooveTemplateKey('I') }).toEqual({
                locale,
                canonicalKey: 'i',
            });
        }
        const migrated = normalizeLegacyProjectData(structuredClone(legacy));
        expect(JSON.stringify(migrated)).toContain('legacy-yeast-i');
        expect(JSON.stringify(migrated)).not.toContain('legacy-yeast-0');
    });

    it('preserves legacy assignments through template dedupe and slug suffix collisions', () => {
        const migrated = normalizeLegacyProjectData({
            version: 1,
            meta: {},
            arrangement: {},
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            yeast: {
                grooveTemplates: [
                    { id: 'A B', name: 'First pocket', offsets: [0, 0.1] },
                    { id: 'duplicate-shape', name: 'Duplicate pocket', offsets: [0, 0.1] },
                    { id: 'a-b', name: 'Second pocket', offsets: [0, 0.2] },
                ],
                assignments: [
                    {
                        consumerType: 'yeast-processor',
                        consumerId: 'deduped-consumer',
                        templateId: 'duplicate-shape',
                        amount: 0.6,
                    },
                    {
                        consumerType: 'yeast-processor',
                        consumerId: 'suffixed-consumer',
                        templateId: 'a-b',
                        amount: 0.7,
                    },
                ],
            },
        });

        if (!isRecord(migrated) || !isRecord(migrated.grooves) || !Array.isArray(migrated.grooves.assignments)) {
            throw new Error('Expected migrated groove assignments');
        }
        expect(migrated.grooves.assignments).toEqual([
            {
                consumerType: 'yeast-processor',
                consumerId: 'deduped-consumer',
                templateId: 'legacy-yeast-a-b',
                amount: 0.6,
            },
            {
                consumerType: 'yeast-processor',
                consumerId: 'suffixed-consumer',
                templateId: 'legacy-yeast-a-b-2',
                amount: 0.7,
            },
        ]);
    });
});
