import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import {
    DawMenuSectionLabel,
    DawMenuSeparator,
    DawMenuMutedRow,
    DawMenuDisabledRow,
    DawMenuButton,
} from '../DawMenuParts';

describe('DawMenuParts', () => {
    it('should render DawMenuSectionLabel', () => {
        render(<DawMenuSectionLabel>Sec</DawMenuSectionLabel>);
        expect(screen.getByText('Sec').tagName).toBe('P');
    });

    it('should render DawMenuSeparator', () => {
        const { container } = render(<DawMenuSeparator data-testid="sep" />);
        expect(container.querySelector('[data-testid="sep"]')).toBeInTheDocument();
    });

    it('should render DawMenuMutedRow', () => {
        render(<DawMenuMutedRow>Hint</DawMenuMutedRow>);
        expect(screen.getByText('Hint')).toBeInTheDocument();
    });

    it('should render DawMenuDisabledRow with icon', () => {
        render(<DawMenuDisabledRow icon={<span data-testid="i">!</span>}>No</DawMenuDisabledRow>);
        expect(screen.getByTestId('i')).toBeInTheDocument();
        expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('should render DawMenuButton with shortcut', () => {
        const onClick = vi.fn();
        render(
            <DawMenuButton onClick={onClick} shortcut="⌘S">
                Save
            </DawMenuButton>
        );
        fireEvent.click(screen.getByRole('button', { name: /Save/ }));
        expect(onClick).toHaveBeenCalled();
        expect(screen.getByText('⌘S')).toBeInTheDocument();
    });
});
