/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type useTranslation } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMetadataLoader } from './createMetadataLoader';
import { setMetadata } from './setMetaTags';

vi.mock(import('./setMetaTags'), () => ({
    setMetadata: vi.fn(),
}));

describe('createMetadatasLoader', () => {
    const mockMetadata = {
        title: 'Test Title',
        description: 'Test Description',
        keywords: 'Test Keywords',
        canonical: 'https://test.com',
    };

    const mockT = vi.fn() as unknown as ReturnType<typeof useTranslation>['t'];

    const mockLoaderData = { someData: 'value' };

    beforeEach(() => {
        vi.mocked(setMetadata).mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls setMetadatas with static metadatas config', () => {
        const loader = createMetadataLoader(mockMetadata);

        loader(mockT, mockLoaderData);

        expect(setMetadata).toHaveBeenCalledOnce();
        expect(setMetadata).toHaveBeenCalledWith(mockMetadata);
    });

    it('calls setMetadatas with result from  function', async () => {
        const metadatasFn = vi.fn().mockReturnValue(mockMetadata);
        const loader = createMetadataLoader(metadatasFn);

        await loader(mockT, mockLoaderData);

        expect(metadatasFn).toHaveBeenCalledOnce();
        expect(metadatasFn).toHaveBeenCalledWith(mockT, mockLoaderData);
        expect(setMetadata).toHaveBeenCalledOnce();
        expect(setMetadata).toHaveBeenCalledWith(mockMetadata);
    });

    it('passes typed loader data to metadatas function', () => {
        type CustomLoaderData = { userId: string; permissions: string[] };
        const customLoaderData: CustomLoaderData = {
            userId: 'user-123',
            permissions: ['read', 'write'],
        };
        const metadatasFn = vi.fn().mockReturnValue(mockMetadata);
        const loader = createMetadataLoader<CustomLoaderData>(metadatasFn);

        loader(mockT, customLoaderData);

        expect(metadatasFn).toHaveBeenCalledWith(mockT, customLoaderData);
    });
});
