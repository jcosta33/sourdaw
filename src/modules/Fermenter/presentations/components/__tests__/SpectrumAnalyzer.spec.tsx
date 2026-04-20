import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

describe('SpectrumAnalyzer (Fermenter)', () => {
    it('should render', () => {
        const { container } = render(<SpectrumAnalyzer buffer={new Float32Array(64)} width={120} height={40} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
