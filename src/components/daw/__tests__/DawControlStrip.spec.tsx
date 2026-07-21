import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawControlStrip } from '../DawControlStrip';

describe('DawControlStrip', () => {
    it('renders the fixed non-shrinking row contract and preserves child order', () => {
        render(
            <DawControlStrip data-testid="control-strip">
                <span>first</span>
                <span>second</span>
            </DawControlStrip>
        );

        const controlStrip = screen.getByTestId('control-strip');

        expect(controlStrip.tagName).toBe('DIV');
        expect(controlStrip).toHaveClass(
            'daw-control-strip',
            'flex',
            'flex-row',
            'min-w-0',
            'gap-2',
            'items-center',
            'justify-start',
            'shrink-0',
            'px-2',
            'py-1'
        );
        expect(Array.from(controlStrip.children, (child) => child.textContent)).toEqual(['first', 'second']);
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawControlStrip
                data-testid="control-strip"
                data-state="ready"
                aria-label="Editor controls"
                role="toolbar"
                style={{ width: '240px' }}
                onClick={handleClick}
            >
                controls
            </DawControlStrip>
        );

        const controlStrip = screen.getByRole('toolbar', { name: 'Editor controls' });

        expect(controlStrip).toHaveAttribute('data-state', 'ready');
        expect(controlStrip).toHaveStyle({ width: '240px' });

        fireEvent.click(controlStrip);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting wrapper and row defaults', () => {
        render(
            <DawControlStrip data-testid="control-strip" className="gap-4 items-start justify-center shrink px-4 py-2">
                controls
            </DawControlStrip>
        );

        const controlStrip = screen.getByTestId('control-strip');

        expect(controlStrip).toHaveClass('gap-4', 'items-start', 'justify-center', 'shrink', 'px-4', 'py-2');
        expect(controlStrip).not.toHaveClass('gap-2', 'items-center', 'justify-start', 'shrink-0', 'px-2', 'py-1');
        expect(controlStrip).toHaveClass('daw-control-strip');
    });
});
