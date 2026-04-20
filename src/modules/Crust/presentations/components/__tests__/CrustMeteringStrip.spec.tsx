import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CrustMeteringStrip } from '../CrustMeteringStrip';

describe('CrustMeteringStrip', () => {
    it('should render', () => {
        render(
            <CrustMeteringStrip
                grDb={-2}
                outputDb={-6}
                lufsIntegrated={-12}
                lufsShortTerm={-11}
                lufsMomentary={-10}
                lra={4}
                truepeakMax={-1}
                truepeakExceeded={false}
                lufsTarget={-14}
                onResetTp={vi.fn()}
            />
        );
        expect(screen.getByText(/output/i)).toBeInTheDocument();
    });
});
