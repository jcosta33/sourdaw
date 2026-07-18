import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearSolos } from '../trackShortcuts/clearSolos';

vi.mock('#/modules/Arrangement/useCases', () => ({
    clearSolos: vi.fn(),
}));

describe('trackShortcuts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clearSolos delegates to the injected implementation', async () => {
        const { clearSolos: clearSolosImpl } = await import('#/modules/Arrangement/useCases');

        clearSolos();

        expect(clearSolosImpl).toHaveBeenCalledTimes(1);
    });
});
