import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutomationModeControl } from '../AutomationControls';

describe('Automation mode control', () => {
    // Covers the mode button and options formerly admitted by automationLanesTestId.
    it('shows the real read label and emits the selected modes', () => {
        const onModeChange = vi.fn();
        render(<AutomationModeControl automationMode="read" laneCount={1} onModeChange={onModeChange} />);
        const button = screen.getByTestId('automation-mode-button');
        expect(button).toHaveAccessibleName('Automation mode: read');
        expect(button).toHaveTextContent('R');
        fireEvent.click(button);
        const menu = screen.getByRole('menu');
        for (const label of ['Read', 'Write', 'Touch', 'Latch']) {
            expect(within(menu).getByRole('button', { name: label })).toBeInTheDocument();
        }
        fireEvent.click(within(menu).getByRole('button', { name: 'Write' }));
        expect(onModeChange).toHaveBeenCalledExactlyOnceWith('write');
    });
});
