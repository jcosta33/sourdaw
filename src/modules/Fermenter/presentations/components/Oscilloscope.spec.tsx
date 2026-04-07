import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Oscilloscope } from './Oscilloscope';

describe('Oscilloscope', () => {
    it('should render', () => {
        const { container } = render(<Oscilloscope buffer={null} width={100} height={40} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
