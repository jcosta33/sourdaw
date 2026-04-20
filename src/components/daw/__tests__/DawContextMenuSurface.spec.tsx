import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawContextMenuSurface } from '../DawContextMenuSurface';

describe('DawContextMenuSurface', () => {
    it('should render children without portal', () => {
        render(
            <DawContextMenuSurface x={10} y={20} portal={false}>
                <span>Item</span>
            </DawContextMenuSurface>
        );
        expect(screen.getByText('Item')).toBeInTheDocument();
    });
});
