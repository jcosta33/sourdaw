import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TonalBalance } from '../TonalBalance';

describe('TonalBalance', () => {
    it('should render', () => {
        const { container } = render(
            <TonalBalance fftData={null} fftVersion={0} sampleRate={44100} fftSize={2048} width={200} height={80} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
