import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { XYMorphPad } from '../XYMorphPad';

describe('XYMorphPad', () => {
    it('should render', () => {
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={vi.fn()}
                onChangeY={vi.fn()}
                snapshots={DEFAULT_PATCH.snapshots}
                width={120}
                height={120}
            />
        );
        expect(container.firstChild).toBeTruthy();
    });

    // Regression: a cancelled gesture clears the dragging flag so a later move does
    // not keep updating the morph position.
    it('stops updating the position after pointercancel', () => {
        const onChangeX = vi.fn();
        const onChangeY = vi.fn();
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={onChangeX}
                onChangeY={onChangeY}
                snapshots={DEFAULT_PATCH.snapshots}
                width={120}
                height={120}
            />
        );
        const pad = container.firstChild as HTMLElement;
        pad.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(pad, { clientX: 60, clientY: 60, pointerId: 1 });
        onChangeX.mockClear();
        onChangeY.mockClear();

        fireEvent.pointerCancel(pad, { pointerId: 1 });
        // Move after cancel must be ignored.
        fireEvent.pointerMove(pad, { clientX: 10, clientY: 90, pointerId: 1 });

        expect(onChangeX).not.toHaveBeenCalled();
        expect(onChangeY).not.toHaveBeenCalled();
    });
});
