import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { LfoSection } from '../LfoSection';

describe('LfoSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        const { container } = render(
            <LfoSection
                rate={p.lfoRate}
                shape={p.lfoShape}
                pitchAmount={p.lfoPitchAmount}
                filterAmount={p.lfoFilterAmount}
                onRateChange={vi.fn()}
                onShapeChange={vi.fn()}
                onPitchAmountChange={vi.fn()}
                onFilterAmountChange={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
