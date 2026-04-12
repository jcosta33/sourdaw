import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WaveshaperEditor } from '../WaveshaperEditor';

describe('WaveshaperEditor', () => {
    it('should render', () => {
        const { container } = render(
            <WaveshaperEditor width={120} height={80} segments={[]} onSegmentsChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
