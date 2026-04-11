import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawMeterBar } from '../DawMeterBar';

describe('DawMeterBar', () => {
    it('should set fill width from value', () => {
        const { container } = render(<DawMeterBar value={40} />);
        const fill = container.querySelector('.h-full.rounded-full');
        expect(fill).toHaveStyle({ width: '40%' });
    });
});
