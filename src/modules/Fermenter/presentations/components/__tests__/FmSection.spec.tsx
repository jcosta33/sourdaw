import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { FmSection } from '../FmSection';

describe('FmSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <FmSection
                algorithm={p.fmAlgorithm}
                ratios={[p.fmRatio1, p.fmRatio2, p.fmRatio3, p.fmRatio4]}
                levels={[p.fmLevel1, p.fmLevel2, p.fmLevel3, p.fmLevel4]}
                feedback={p.fmFeedback}
                modAmount={p.fmModAmount}
                onParam={vi.fn()}
            />
        );
        expect(screen.getByText(/fm engine/i)).toBeInTheDocument();
    });
});
