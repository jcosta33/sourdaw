import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DecayEqOverlay } from '../DecayEqOverlay';

describe('DecayEqOverlay', () => {
    it('should render', () => {
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={vi.fn()} width={200} height={60} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
