import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

describe('SpectrumAnalyzer (Fermenter)', () => {
    it('should render', () => {
        const { container } = render(<SpectrumAnalyzer deviceId="device-1" width={120} height={40} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
