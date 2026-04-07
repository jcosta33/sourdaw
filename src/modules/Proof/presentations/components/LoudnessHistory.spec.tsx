import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoudnessHistory } from './LoudnessHistory';

describe('LoudnessHistory', () => {
    it('should render', () => {
        const { container } = render(
            <LoudnessHistory momentaryLufs={-12} targetLufs={-14} integratedLufs={-13} width={200} height={48} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
