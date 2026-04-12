import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BezierLfoEditor } from '../BezierLfoEditor';

describe('BezierLfoEditor', () => {
    it('should render', () => {
        const { container } = render(
            <BezierLfoEditor width={120} height={80} points={[]} onPointsChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
