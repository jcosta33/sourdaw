import { describe, expect, it } from 'vitest';

import { createBuiltinGrooveTemplates } from '../models/BuiltinGrooveTemplates';
import { isGrooveTemplate } from '../models/GrooveTemplate';
import { applyGrooveTemplate } from '../useCases/grooveTemplates/applyGrooveTemplate';

const REQUIRED_LIBRARY_IDS = [
    'tr-808-shuffle',
    'tr-909-swing-58',
    'mpc-swing-54',
    'mpc-swing-62',
    'sp-1200-straight',
    'j-dilla-late-snare',
] as const;

describe('builtin groove template library', () => {
    it.each(REQUIRED_LIBRARY_IDS)('ships and executes the curated %s definition', (templateId) => {
        const template = createBuiltinGrooveTemplates().find((candidate) => candidate.id === templateId);
        expect(template).toBeDefined();
        expect(isGrooveTemplate(template)).toBe(true);
        if (!template) {
            throw new Error(`Missing curated template ${templateId}`);
        }

        const source = Array.from({ length: 16 }, (_, index) => ({
            id: `note-${index}`,
            startBeat: index * 0.25,
            velocity: 96,
        }));
        const first = applyGrooveTemplate({ events: source, template, amount: 1 });
        const second = applyGrooveTemplate({ events: source, template, amount: 1 });

        expect(first).toEqual(second);
        expect(
            first.some((event, index) => event.startBeat !== source[index]?.startBeat || event.velocity !== 96)
        ).toBe(true);
    });
});
