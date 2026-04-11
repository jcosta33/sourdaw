import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GrMeter } from '../GrMeter';

describe('GrMeter', () => {
    it('should render', () => {
        const { container } = render(<GrMeter grDb={-2} inputDb={-10} outputDb={-10} width={40} height={80} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
