/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type UIMatch } from 'react-router';
import { describe, it, expect } from 'vitest';

import { getFirstMatchOfHandler } from './getFirstMatchOfHandler';

describe('getFirstMatchOfHandler', () => {
    it('should return the last match with navigationLoader', () => {
        const matches = [
            { id: '1', handle: { other: 1 } },
            { id: '2', handle: { navigationLoader: () => Promise.resolve() } },
            { id: '3', handle: { other: 2 } },
        ] as unknown as UIMatch[];

        const [result] = getFirstMatchOfHandler(matches, ['navigationLoader']);
        expect(result?.id).toBe('2');
    });

    it('should return the last match with metadataLoader', () => {
        const matches = [
            { id: '1', handle: { other: 1 } },
            { id: '2', handle: { metadataLoader: () => ({}) } },
            { id: '3', handle: { other: 2 } },
        ] as unknown as UIMatch[];

        const [result] = getFirstMatchOfHandler(matches, ['metadataLoader']);
        expect(result?.id).toBe('2');
    });

    it('should return correct matches when both are requested', () => {
        const matches = [
            { id: '1', handle: { navigationLoader: () => Promise.resolve() } },
            { id: '2', handle: { metadataLoader: () => ({}) } },
            { id: '3', handle: { other: 2 } },
        ] as unknown as UIMatch[];

        const [navigationMatch, metadataMatch] = getFirstMatchOfHandler(matches, [
            'navigationLoader',
            'metadataLoader',
        ]);
        expect(navigationMatch?.id).toBe('1');
        expect(metadataMatch?.id).toBe('2');
    });

    it('should return null for keys not found', () => {
        const matches = [
            { id: '1', handle: { other: 1 } },
            { id: '2', handle: { other: 2 } },
        ] as unknown as UIMatch[];

        const [result] = getFirstMatchOfHandler(matches, ['navigationLoader']);
        expect(result).toBeNull();
    });

    it('should handle same match having multiple handlers', () => {
        const matches = [
            {
                id: '1',
                handle: {
                    navigationLoader: () => Promise.resolve(),
                    metadataLoader: () => ({}),
                },
            },
        ] as unknown as UIMatch[];

        const [navigationMatch, metadataMatch] = getFirstMatchOfHandler(matches, [
            'navigationLoader',
            'metadataLoader',
        ]);
        expect(navigationMatch?.id).toBe('1');
        expect(metadataMatch?.id).toBe('1');
    });

    it('should return results in the order of keys requested', () => {
        const matches = [
            { id: '1', handle: { navigationLoader: () => Promise.resolve() } },
            { id: '2', handle: { metadataLoader: () => ({}) } },
        ] as unknown as UIMatch[];

        const [metadataMatch, navigationMatch] = getFirstMatchOfHandler(matches, [
            'metadataLoader',
            'navigationLoader',
        ]);
        expect(metadataMatch?.id).toBe('2');
        expect(navigationMatch?.id).toBe('1');
    });
});
