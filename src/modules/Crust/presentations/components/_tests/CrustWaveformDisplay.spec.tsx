import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CrustWaveformDisplay } from '../CrustWaveformDisplay';

describe('CrustWaveformDisplay', () => {
    it('should render', () => {
        const { container } = render(
            <CrustWaveformDisplay
                grDb={0}
                inputDb={-6}
                outputDb={-6}
                lufsShortTerm={-12}
                lufsTarget={-14}
                deltaListen={false}
                scrollSpeed="normal"
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
