import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CrossoverDisplay } from '../CrossoverDisplay';

describe('CrossoverDisplay', () => {
    it('should render', () => {
        render(
            <CrossoverDisplay
                bandCount={2}
                crossoverFreqs={[500, 2000]}
                crossoverMode="lr4"
                activeBand={0}
                onBandSelect={vi.fn()}
                onCrossoverChange={vi.fn()}
            />
        );
        expect(screen.getByText('lr4')).toBeInTheDocument();
    });
});
