/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, expect, it, vi } from 'vitest';

import { createPageLoader } from './createPageLoader';

describe('createPageLoader', () => {
    it('returns the provided loader function unchanged', () => {
        const mockLoader = vi.fn().mockReturnValue(true);

        const result = createPageLoader(mockLoader);

        expect(result).toBe(mockLoader);
    });
});
