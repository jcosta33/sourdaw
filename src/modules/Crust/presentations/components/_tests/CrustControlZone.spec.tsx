import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrustControlZone } from '../CrustControlZone';
import { DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';

describe('CrustControlZone', () => {
    it('should render', () => {
        render(
            <CrustControlZone
                patch={DEFAULT_CRUST_PATCH}
                setParam={vi.fn()}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );
        expect(screen.getByText(/algorithm/i)).toBeInTheDocument();
    });
});
