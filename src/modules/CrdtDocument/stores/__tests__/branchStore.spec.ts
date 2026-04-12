import { describe, expect, it } from 'vitest';

import { MAIN_BRANCH_ID } from '../branchStore';

describe('branchStore', () => {
    it('uses a stable id for the main branch', () => {
        expect(MAIN_BRANCH_ID).toBe('main');
    });
});
