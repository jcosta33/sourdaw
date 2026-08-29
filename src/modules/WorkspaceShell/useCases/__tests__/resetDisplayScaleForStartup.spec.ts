import { describe, expect, it, vi } from 'vitest';

import { setDisplayScale } from '../../repositories/setDisplayScale';
import { resetDisplayScaleForStartup } from '../resetDisplayScaleForStartup';

vi.mock('../../repositories/setDisplayScale', () => ({ setDisplayScale: vi.fn() }));

describe('resetDisplayScaleForStartup', () => {
    it('resets the effective renderer scale without writing the stored preference', async () => {
        await resetDisplayScaleForStartup();

        expect(setDisplayScale).toHaveBeenCalledOnce();
        expect(setDisplayScale).toHaveBeenCalledWith(1);
    });
});
