import { describe, expect, it } from 'vitest';

import { separateStems } from '../separateStems';

describe('separateStems', () => {
    it('fails closed without an admitted model', async () => {
        await expect(separateStems(new ArrayBuffer(8), ['vocals'])).rejects.toThrow(
            'Stem separation is unavailable until a compatible model is admitted.'
        );
    });
});
