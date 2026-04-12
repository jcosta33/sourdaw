import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CrustSatCurve } from '../CrustSatCurve';

describe('CrustSatCurve', () => {
    it('should render', () => {
        const { container } = render(<CrustSatCurve algorithm="soft" drive={3} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
