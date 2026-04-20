import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

describe('SpectrumAnalyzer', () => {
    it('should render', () => {
        const { container } = render(<SpectrumAnalyzer width={200} height={60} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
