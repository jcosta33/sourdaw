import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SpectralBinEditor } from '../SpectralBinEditor';

describe('SpectralBinEditor', () => {
    it('should render', () => {
        const { container } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.5)}
                onBinValuesChange={vi.fn()}
                mode="gate"
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
