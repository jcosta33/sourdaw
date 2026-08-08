import { describe, expect, it } from 'vitest';

import { NODE_COLORS, getNextConnectionId, getNextNodeId, type ProcessingNodeType } from '../nodeView';

describe('getNextNodeId', () => {
    it('returns a string prefixed with "node-"', () => {
        const id = getNextNodeId();

        expect(id.startsWith('node-')).toBe(true);
    });

    it('generates unique ids across calls', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i += 1) {
            ids.add(getNextNodeId());
        }

        expect(ids.size).toBe(100);
    });
});

describe('getNextConnectionId', () => {
    it('returns a string prefixed with "conn-"', () => {
        const id = getNextConnectionId();

        expect(id.startsWith('conn-')).toBe(true);
    });

    it('generates unique ids across calls', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i += 1) {
            ids.add(getNextConnectionId());
        }

        expect(ids.size).toBe(100);
    });
});

describe('NODE_COLORS', () => {
    it('maps every ProcessingNodeType to an oklch color string', () => {
        const allTypes: ProcessingNodeType[] = [
            'input',
            'output',
            'effect',
            'instrument',
            'mixer',
            'splitter',
            'merger',
            'send',
            'return',
            'sidechain',
        ];

        for (const type of allTypes) {
            const color = NODE_COLORS[type];
            expect(color).toBeDefined();
            expect(color.startsWith('oklch(')).toBe(true);
            expect(color.endsWith(')')).toBe(true);
        }
    });

    it('has exactly 10 entries (one per ProcessingNodeType)', () => {
        expect(Object.keys(NODE_COLORS)).toHaveLength(10);
    });
});
