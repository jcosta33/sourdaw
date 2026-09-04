import { describe, expect, it, vi } from 'vitest';

import { reloadApplication } from '../reloadApplication';

describe('reloadApplication', () => {
    it('delegates recovery to the supplied browser location', () => {
        const reload = vi.fn();

        reloadApplication({ reload });

        expect(reload).toHaveBeenCalledOnce();
    });
});
