import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawPanelSurface } from '../DawPanelSurface';

describe('DawPanelSurface', () => {
    it('should render as aside when as is aside', () => {
        render(
            <DawPanelSurface as="aside" tone="tray">
                Panel
            </DawPanelSurface>
        );
        expect(screen.getByText('Panel').closest('aside')).not.toBeNull();
    });
});
