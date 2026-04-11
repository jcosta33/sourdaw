import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LfoSection } from '../LfoSection';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';

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
