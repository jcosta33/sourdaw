import { type ReactElement, useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { PianoRollContextMenu } from '../PianoRollContextMenu';

// Deliberately NOT mocked: `DawContextMenuSurface` (whose focus management must
// receive the parent's close callback) and `useContextMenuDismiss`.

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

type MenuHarnessProps = {
    onClose: () => void;
};

const MenuHarness = ({ onClose }: MenuHarnessProps): ReactElement => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div>
            <button data-testid="prior-control" type="button">
                Play
            </button>
            <div data-testid="piano-roll" onContextMenu={() => setIsOpen(true)}>
                piano roll
            </div>
            {isOpen ? (
                <PianoRollContextMenu
                    clipId="clip-1"
                    menu={{ x: 100, y: 100, beat: 4 }}
                    notes={[]}
                    onClose={() => {
                        onClose();
                        setIsOpen(false);
                    }}
                    onClearSelection={vi.fn()}
                    onSelectAll={vi.fn()}
                    selectedNoteIds={new Set<string>()}
                />
            ) : null}
        </div>
    );
};

describe('PianoRollContextMenu focus management', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes through the parent onClose when focus leaves the piano-roll menu surface', () => {
        const onClose = vi.fn();
        render(
            <TooltipProvider>
                <MenuHarness onClose={onClose} />
            </TooltipProvider>
        );

        const priorControl = screen.getByTestId('prior-control');
        priorControl.focus();
        fireEvent.contextMenu(screen.getByTestId('piano-roll'));

        const menu = screen.getByRole('menu');
        expect(menu).toHaveFocus();

        // The surface must hold the parent's close callback: a focusout with
        // no inside related target is the surface closing itself, so the
        // piano-roll menu cannot stay open behind ungated keydowns.
        fireEvent.focusOut(menu, { relatedTarget: document.createElement('button') });

        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(priorControl).toHaveFocus();
    });
});
