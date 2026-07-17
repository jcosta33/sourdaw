import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Oscilloscope } from '../Oscilloscope';

describe('Oscilloscope', () => {
    it('should render', () => {
        const { container } = render(<Oscilloscope deviceId="device-1" width={100} height={40} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
