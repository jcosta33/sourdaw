import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';

import { useContextMenuDismiss } from '../useContextMenuDismiss';

function MenuHarness({ onClose }: { onClose: () => void }): ReactElement {
    const ref = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(ref, onClose);
    return (
        <div ref={ref} data-testid="menu">
            Menu
        </div>
    );
}

describe('useContextMenuDismiss', () => {
    it('should call onClose when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<MenuHarness onClose={onClose} />);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when mousedown happens outside the menu', () => {
        const onClose = vi.fn();
        render(
            <div>
                <MenuHarness onClose={onClose} />
                <button type="button">Outside</button>
            </div>
        );

        fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when mousedown is inside the menu', () => {
        const onClose = vi.fn();
        render(<MenuHarness onClose={onClose} />);

        fireEvent.mouseDown(screen.getByTestId('menu'));

        expect(onClose).not.toHaveBeenCalled();
    });
});
