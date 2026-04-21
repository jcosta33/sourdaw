import { describe, it, expect } from 'vitest';

import { toPublicPatternTemplate, toPromptPreset } from '../helpers';
import { type PatternTemplateModel } from '../helpers';

describe('aiRuntimeQueries helpers', () => {
    describe('toPublicPatternTemplate', () => {
        it('maps model pattern template to public format', () => {
            function mockGenerate() {
                return [{ pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }];
            }
            const modelTemplate: PatternTemplateModel = {
                id: 't1',
                name: 'Test Template',
                category: 'drum',
                genres: ['pop'],
                tags: ['basic'],
                description: 'test description',
                lengthBeats: 4,
                generate: mockGenerate,
            };

            const mapped = toPublicPatternTemplate(modelTemplate);

            expect(mapped.id).toBe('t1');
            expect(mapped.name).toBe('Test Template');
            expect(mapped.category).toBe('drum');
            expect(mapped.genres).toEqual(['pop']);
            expect(mapped.tags).toEqual(['basic']);
            expect(mapped.description).toBe('test description');
            expect(mapped.lengthBeats).toBe(4);

            const notes = mapped.generate({} as any);
            expect(notes).toEqual([{ pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }]);
        });
    });

    describe('toPromptPreset', () => {
        it('maps preset action to prompt preset format', () => {
            const presetAction = {
                id: 'p1',
                label: 'Test Preset',
                category: 'Track' as const,
                isDestructive: true,
                keywords: [],
                requiresSelection: 'none' as const,
                buildAction: () => null,
            };

            const mapped = toPromptPreset(presetAction);

            expect(mapped.id).toBe('p1');
            expect(mapped.label).toBe('Test Preset');
            expect(mapped.category).toBe('Track');
            expect(mapped.isDestructive).toBe(true);
        });

        it('defaults isDestructive to false if undefined', () => {
            const presetAction = {
                id: 'p2',
                label: 'Test Preset 2',
                category: 'Global' as const,
                keywords: [],
                requiresSelection: 'none' as const,
                buildAction: () => null,
            };

            const mapped = toPromptPreset(presetAction);

            expect(mapped.isDestructive).toBe(false);
        });
    });
});
