import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { getApplicationOwnedToolSchemas } from '../getApplicationOwnedToolSchemas';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { readBriefMixIntent } from '../readBriefMixIntent';

registerDeviceEnginePorts();

describe('brief mix intent', () => {
    it('publishes a required closed selection in canonical and strict hosted schemas', () => {
        const schema = getApplicationOwnedToolSchemas().find((entry) => entry.function.name === 'brief.compile');
        if (schema === undefined) throw new Error('brief.compile is not published');
        expect(schema.function.parameters.required).toContain('mixIntent');
        const strict = projectOpenAiStrictToolSchema(schema);
        const canonicalIntent = schema.function.parameters.properties.mixIntent;
        const strictIntent = strict.function.parameters.properties.mixIntent;
        const catalog = getBriefMixIntentCatalog();
        const valid = { catalogId: catalog.catalogId, requestedDescriptors: ['warm', 'wide'] };
        for (const projected of [canonicalIntent, strictIntent]) {
            expect(matchesJsonSchema(valid, projected)).toBe(true);
            expect(matchesJsonSchema(null, projected)).toBe(false);
            expect(matchesJsonSchema({ ...valid, extra: true }, projected)).toBe(false);
            expect(matchesJsonSchema({ ...valid, catalogId: 'foreign' }, projected)).toBe(false);
            expect(matchesJsonSchema({ ...valid, requestedDescriptors: ['unknown'] }, projected)).toBe(false);
        }
        expect(matchesJsonSchema({ ...valid, requestedDescriptors: ['warm', 'warm'] }, canonicalIntent)).toBe(false);
        // Strict hosted providers omit uniqueItems and maxItems; the runtime still enforces both.
        expect(readBriefMixIntent({ ...valid, requestedDescriptors: ['warm', 'warm'] })).toBeNull();
        expect(readBriefMixIntent({ ...valid, requestedDescriptors: [...catalog.descriptors, 'warm'] })).toBeNull();
    });
});
