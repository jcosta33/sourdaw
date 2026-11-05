import { describe, expect, it } from 'vitest';

import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { getApplicationOwnedToolSchemas } from '../../../../useCases/applicationOwnedToolLoop';
import { projectAnthropicStrictToolSchema } from '../projectAnthropicStrictToolSchema';
import { projectOpenAiStrictToolSchema } from '../projectOpenAiStrictToolSchema';
import { selectAnthropicStrictTools } from '../selectAnthropicStrictTools';

const PUBLISHED_FILTER_KEYS = [
    'stableId',
    'exactName',
    'fuzzyName',
    'kind',
    'tag',
    'role',
    'parentId',
    'sectionId',
    'deviceType',
    'deviceCategory',
    'routeFromId',
    'routeToId',
    'assetType',
    'selected',
    'locked',
    'muted',
    'soloed',
    'hasAutomation',
    'startBeat',
    'endBeat',
    'minInferredConfidence',
    'contentType',
];

function findTool(schemas: readonly ToolSchema[], name: string): ToolSchema {
    const found = schemas.find((schema) => schema.function.name === name);
    if (found === undefined) {
        throw new Error(`${name} is not published`);
    }
    return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFilters(schema: ToolSchema): Record<string, unknown> {
    const filters = schema.function.parameters.properties.filters;
    if (!isRecord(filters)) {
        throw new Error('filters is not an object schema');
    }
    return filters;
}

function withoutFilterProperties(schema: ToolSchema): ToolSchema {
    return {
        ...schema,
        function: {
            ...schema.function,
            parameters: {
                ...schema.function.parameters,
                properties: {
                    ...schema.function.parameters.properties,
                    filters: { type: 'object', additionalProperties: false },
                },
            },
        },
    };
}

function strictNames(schemas: readonly ToolSchema[]): string[] {
    const admitted = selectAnthropicStrictTools(schemas);
    return schemas.filter((_, index) => admitted[index]).map((schema) => schema.function.name);
}

describe('project.query filters under strict tool schemas', () => {
    const published = getApplicationOwnedToolSchemas().map(projectAnthropicStrictToolSchema);

    it('sends project.query non-strict on Anthropic because its optional parameters alone pass the cap', () => {
        const projectQuery = findTool(published, 'project.query');

        expect(selectAnthropicStrictTools([projectQuery])).toEqual([false]);
        expect(selectAnthropicStrictTools([withoutFilterProperties(projectQuery)])).toEqual([true]);
    });

    it('pins which published tools are strict on Anthropic', () => {
        expect(new Set(strictNames(published))).toEqual(
            new Set([
                'project.discover',
                'project.resolve',
                'agent.capabilities',
                'agent.catalog.discover',
                'agent.command-index.search',
                'transform.compile',
                'device.factory-manifest.read',
                'command.batch.decline',
                'command.history',
                'render.request',
                'analysis.request',
                'analysis.detectTransients',
            ])
        );
    });

    it('keeps every published filter on the OpenAI strict projection', () => {
        const projected = projectOpenAiStrictToolSchema(findTool(getApplicationOwnedToolSchemas(), 'project.query'));
        const filters = readFilters(projected);
        const properties = isRecord(filters.properties) ? filters.properties : {};
        const required = Array.isArray(filters.required) ? filters.required : [];

        expect(new Set(Object.keys(properties))).toEqual(new Set(PUBLISHED_FILTER_KEYS));
        expect(new Set(required)).toEqual(new Set(PUBLISHED_FILTER_KEYS));
    });
});
