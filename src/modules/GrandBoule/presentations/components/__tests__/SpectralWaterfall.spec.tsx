import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SpectralWaterfall } from '../SpectralWaterfall';

describe('SpectralWaterfall', () => {
    it('should render', () => {
        const { container } = render(<SpectralWaterfall fftFrame={null} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
