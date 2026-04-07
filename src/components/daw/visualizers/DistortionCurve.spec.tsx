import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DistortionCurve } from './DistortionCurve';

describe('DistortionCurve', () => {
    it('should render canvas', () => {
        const { container } = render(<DistortionCurve drive={50} tone={4000} mix={0.5} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
