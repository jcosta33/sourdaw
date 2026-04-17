import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WaveformDisplay } from '../WaveformDisplay';

describe('WaveformDisplay', () => {
    it('should render', () => {
        const { container } = render(
            <WaveformDisplay peaks={[0, 1, 0, -1]} totalFrames={100} height={48} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
