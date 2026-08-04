import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/setEditingTool', () => ({
    setEditingTool: vi.fn(),
}));

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(),
}));

import { setEditingTool } from '../../../useCases/setEditingTool';
import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { ToolSelector } from '../ToolSelector';

const mockedSetEditingTool = vi.mocked(setEditingTool);
const mockedUseWorkspaceState = vi.mocked(useWorkspaceState);

function setActiveTool(tool: string): void {
    mockedUseWorkspaceState.mockReturnValue({ activeTool: tool } as never);
}

beforeEach(() => {
    vi.clearAllMocks();
    setActiveTool('select');
});

describe('ToolSelector — radio group structure', () => {
    it('renders a radiogroup with aria-label "Editing tools"', () => {
        render(<ToolSelector />);
        expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', 'Editing tools');
    });

    it('renders exactly 6 radio buttons', () => {
        render(<ToolSelector />);
        expect(screen.getAllByRole('radio')).toHaveLength(6);
    });

    it('radio labels match TOOL_LABELS', () => {
        render(<ToolSelector />);
        const labels = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'));
        expect(labels).toContain('Select (S)');
        expect(labels).toContain('Cut (C)');
        expect(labels).toContain('Draw (D/B)');
        expect(labels).toContain('Auto-draw');
        expect(labels).toContain('Stretch (T)');
        expect(labels).toContain('Marquee (E)');
    });
});

describe('ToolSelector — active selection', () => {
    it('marks the active tool as checked', () => {
        setActiveTool('draw');
        render(<ToolSelector />);
        const drawButton = screen.getByRole('radio', { name: 'Draw (D/B)' });
        expect(drawButton).toHaveAttribute('aria-checked', 'true');
    });

    it('marks non-active tools as unchecked', () => {
        setActiveTool('select');
        render(<ToolSelector />);
        const cutButton = screen.getByRole('radio', { name: 'Cut (C)' });
        expect(cutButton).toHaveAttribute('aria-checked', 'false');
    });
});

describe('ToolSelector — click wiring', () => {
    it('calls setEditingTool with the clicked tool', () => {
        render(<ToolSelector />);
        fireEvent.click(screen.getByRole('radio', { name: 'Stretch (T)' }));
        expect(mockedSetEditingTool).toHaveBeenCalledWith('stretch');
    });
});

describe('ToolSelector — ripple toggle (conditional render)', () => {
    it('does not render ripple toggle when onToggleRipple is undefined', () => {
        render(<ToolSelector />);
        expect(screen.queryByRole('button', { name: /ripple/i })).toBeNull();
    });

    it('does not render ripple toggle when onToggleRipple is null', () => {
        render(<ToolSelector onToggleRipple={null as unknown as undefined} />);
        expect(screen.queryByRole('button', { name: /ripple/i })).toBeNull();
    });

    it('renders ripple toggle when onToggleRipple is provided', () => {
        render(<ToolSelector onToggleRipple={vi.fn()} rippleEditing={false} />);
        expect(screen.getByRole('button', { name: /ripple/i })).toBeInTheDocument();
    });

    it('ripple toggle has aria-pressed false when not ripple editing', () => {
        render(<ToolSelector onToggleRipple={vi.fn()} rippleEditing={false} />);
        expect(screen.getByRole('button', { name: /ripple/i })).toHaveAttribute('aria-pressed', 'false');
    });

    it('ripple toggle has aria-pressed true when ripple editing', () => {
        render(<ToolSelector onToggleRipple={vi.fn()} rippleEditing />);
        expect(screen.getByRole('button', { name: /ripple/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('calls onToggleRipple when clicked', () => {
        const onToggleRipple = vi.fn();
        render(<ToolSelector onToggleRipple={onToggleRipple} rippleEditing={false} />);
        fireEvent.click(screen.getByRole('button', { name: /ripple/i }));
        expect(onToggleRipple).toHaveBeenCalledTimes(1);
    });
});
