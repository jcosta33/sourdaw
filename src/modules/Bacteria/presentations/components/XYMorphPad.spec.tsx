import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { XYMorphPad } from './XYMorphPad';
import { DEFAULT_PATCH } from '../../models/BacteriaPatch';

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
});
