import { describe, expect, it, vi } from 'vitest';

import { setDisplayScale } from '../../repositories/setDisplayScale';
import { applyDisplayScale } from '../applyDisplayScale';

vi.mock('../../repositories/setDisplayScale', () => ({ setDisplayScale: vi.fn() }));

describe('applyDisplayScale', () => {
    it.each([0.5, 2])('preserves the supported UI scale boundary %s', (scale) => {
        applyDisplayScale(scale);

        expect(setDisplayScale).toHaveBeenLastCalledWith(scale);
    });

    it.each([0, -1, 2.01, 100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'normalizes unsupported UI scale %s before reaching the platform repository',
        (scale) => {
            applyDisplayScale(scale);

            expect(setDisplayScale).toHaveBeenLastCalledWith(1);
        }
    );
});
