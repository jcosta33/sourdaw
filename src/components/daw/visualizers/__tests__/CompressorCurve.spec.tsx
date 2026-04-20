import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CompressorCurve } from '../CompressorCurve';

describe('CompressorCurve', () => {
    it('should render canvas', () => {
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
