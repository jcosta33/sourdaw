import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DelayTaps } from '../DelayTaps';

describe('DelayTaps', () => {
    it('should render canvas', () => {
        const { container } = render(<DelayTaps time={250} feedback={0.3} mix={0.5} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
