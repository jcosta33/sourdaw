import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { XYPad } from './XYPad';

describe('XYPad', () => {
    it('should render', () => {
        const { container } = render(
            <XYPad xValue={0.5} yValue={0.5} onXChange={vi.fn()} onYChange={vi.fn()} size={80} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
