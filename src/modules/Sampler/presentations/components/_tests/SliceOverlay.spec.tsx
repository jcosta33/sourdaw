import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SliceOverlay } from '../SliceOverlay';

describe('SliceOverlay', () => {
    it('should render', () => {
        const { container } = render(
            <SliceOverlay
                markers={[{ id: 'm1', framePosition: 100, label: 'A' }]}
                totalFrames={1000}
                activeSliceIndex={0}
                width={200}
                height={40}
                onMarkerDrag={vi.fn()}
                onSelectSlice={vi.fn()}
            />
        );
        expect(container.querySelector('div')).toBeTruthy();
    });
});
