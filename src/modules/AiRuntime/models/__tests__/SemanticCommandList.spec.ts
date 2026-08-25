import { describe, expect, it } from 'vitest';

import {
    SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH,
    SEMANTIC_COMMAND_LIST_MAX_JSON_NODES,
    parseSemanticCommandList,
} from '../SemanticCommandList';

function createCommandList(commandArguments: Record<string, unknown>) {
    return {
        schemaVersion: 1,
        items: [
            {
                id: 'command-1',
                name: 'track.rename',
                arguments: commandArguments,
            },
        ],
    };
}

function createNestedValue(objectDepth: number): unknown {
    let value: unknown = 'leaf';
    for (let depth = 0; depth < objectDepth; depth += 1) {
        value = { nested: value };
    }
    return value;
}

describe('parseSemanticCommandList', () => {
    it('accepts structurally valid arguments at the JSON depth limit', () => {
        const value = createCommandList({
            payload: createNestedValue(SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH - 4),
        });

        expect(parseSemanticCommandList(value).status).toBe('accepted');
    });

    it('rejects arguments beyond the JSON depth limit without throwing', () => {
        const value = createCommandList({
            payload: createNestedValue(SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH - 3),
        });

        expect(() => parseSemanticCommandList(value)).not.toThrow();
        expect(parseSemanticCommandList(value).status).toBe('rejected');
    });

    it('rejects arguments beyond the JSON node budget without throwing', () => {
        const oversizedArguments: Record<string, unknown> = {};
        for (let index = 0; index < SEMANTIC_COMMAND_LIST_MAX_JSON_NODES; index += 1) {
            oversizedArguments[`value-${index}`] = index;
        }
        const value = createCommandList(oversizedArguments);

        expect(() => parseSemanticCommandList(value)).not.toThrow();
        expect(parseSemanticCommandList(value).status).toBe('rejected');
    });

    it('rejects cyclic in-process input without looping or throwing', () => {
        const cyclicValue: Record<string, unknown> = {};
        cyclicValue.self = cyclicValue;
        const value = createCommandList({ payload: cyclicValue });

        expect(() => parseSemanticCommandList(value)).not.toThrow();
        expect(parseSemanticCommandList(value).status).toBe('rejected');
    });
});
