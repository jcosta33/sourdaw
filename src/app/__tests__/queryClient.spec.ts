import { describe, it, expect } from 'vitest';

import { queryClient } from '../queryClient';

describe('queryClient', () => {
    it('should use stable query defaults without retry or focus refetch', () => {
        const q = queryClient.getDefaultOptions().queries;
        expect(q?.retry).toBe(false);
        expect(q?.refetchOnWindowFocus).toBe(false);
        expect(q?.staleTime).toBe(60_000);
    });
});
