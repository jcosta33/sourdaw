import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { LayoutSection } from '../LayoutSection';

function findButtonByRow(rowLabel: string, buttonText: 'Left' | 'Right'): HTMLElement | undefined {
    const row = screen.getByText(rowLabel).closest('div');
    return row ? Array.from(row.querySelectorAll('button')).find((b) => b.textContent === buttonText) : undefined;
}

describe('LayoutSection', () => {
    it('marks the current placement of the Browser and Inspector panels as selected', () => {
        render(
            <LayoutSection
                prefs={{
                    ...defaultPreferences,
                    panelPlacementSidebar: 'left',
                    panelPlacementInspector: 'right',
                }}
                update={vi.fn()}
            />
        );

        expect(findButtonByRow('Browser (Sidebar)', 'Left')).toHaveAttribute('data-variant', 'secondary');
        expect(findButtonByRow('Browser (Sidebar)', 'Right')).toHaveAttribute('data-variant', 'outline');
        expect(findButtonByRow('Inspector', 'Right')).toHaveAttribute('data-variant', 'secondary');
        expect(findButtonByRow('Inspector', 'Left')).toHaveAttribute('data-variant', 'outline');
    });

    it('calls update with the clicked side for the Browser panel', () => {
        const update = vi.fn();
        render(<LayoutSection prefs={{ ...defaultPreferences, panelPlacementSidebar: 'left' }} update={update} />);

        const rightButton = findButtonByRow('Browser (Sidebar)', 'Right');
        expect(rightButton).toBeDefined();
        if (rightButton) {
            fireEvent.click(rightButton);
        }

        expect(update).toHaveBeenCalledWith({ panelPlacementSidebar: 'right' });
    });

    it('calls update with the clicked side for the Chat panel', () => {
        const update = vi.fn();
        render(<LayoutSection prefs={{ ...defaultPreferences, panelPlacementChat: 'right' }} update={update} />);

        const leftButton = findButtonByRow('Chat Panel', 'Left');
        expect(leftButton).toBeDefined();
        if (leftButton) {
            fireEvent.click(leftButton);
        }

        expect(update).toHaveBeenCalledWith({ panelPlacementChat: 'left' });
    });

    it('calls update with the clicked side for the AI Generation panel', () => {
        const update = vi.fn();
        render(<LayoutSection prefs={{ ...defaultPreferences, panelPlacementAi: 'right' }} update={update} />);

        const leftButton = findButtonByRow('AI Generation', 'Left');
        expect(leftButton).toBeDefined();
        if (leftButton) {
            fireEvent.click(leftButton);
        }

        expect(update).toHaveBeenCalledWith({ panelPlacementAi: 'left' });
    });
});
