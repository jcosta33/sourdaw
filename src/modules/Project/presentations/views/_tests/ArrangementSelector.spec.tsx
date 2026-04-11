import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { forwardRef } from 'react';
import { ArrangementSelector } from '../ArrangementSelector';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        arrangements: [
            { id: 'arr-1', name: 'Arrangement 1' },
            { id: 'arr-2', name: 'Arrangement 2' },
        ],
        activeArrangementId: 'arr-1',
    })),
}));

vi.mock('../../../stores/arrangementStore', () => ({
    arrangementStore: { name: 'arrangementStore', value: null },
}));

vi.mock('../../../useCases/arrangement/renameArrangement', () => ({
    renameArrangement: vi.fn(),
}));

vi.mock('../../../useCases/arrangement/duplicateArrangement', () => ({
    duplicateArrangement: vi.fn(),
}));

vi.mock('../../../useCases/arrangement/createArrangement', () => ({
    createArrangement: vi.fn(),
}));

vi.mock('../../../useCases/arrangement/switchArrangement', () => ({
    switchArrangement: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawCompactInput', () => ({
    DawCompactInput: forwardRef(({ value, onChange, onKeyDown }: any, ref: any) => (
        <input 
            ref={ref}
            value={value} 
            onChange={onChange} 
            onKeyDown={onKeyDown}
            data-testid="compact-input"
        />
    )),
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="menu-section-label">{children}</div>
    ),
    DawMenuSeparator: () => <hr data-testid="menu-separator" />,
}));

vi.mock('#/components/daw/DawPickerRow', () => ({
    DawPickerRow: ({ heading, active, onClick }: any) => (
        <div data-testid="picker-row" data-active={active} onClick={onClick}>
            {heading}
        </div>
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { switchArrangement } = await import('../../../useCases/arrangement');

describe('ArrangementSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-1', name: 'Arrangement 1' },
                { id: 'arr-2', name: 'Arrangement 2' },
            ],
            activeArrangementId: 'arr-1',
        });
    });

    it('should render null when there is only one arrangement', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [{ id: 'arr-1', name: 'Arrangement 1' }],
            activeArrangementId: 'arr-1',
        });
        
        const { container } = render(<ArrangementSelector />);
        expect(container.firstChild).toBeNull();
    });

    it('should render selector when multiple arrangements exist', () => {
        const { container } = render(<ArrangementSelector />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('should display current arrangement name', () => {
        render(<ArrangementSelector />);
        expect(screen.getByText(/Arrangement 1/i)).toBeInTheDocument();
    });

    it('should show dropdown when clicked', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render all arrangements in dropdown', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        // Use getAllByText since arrangement name appears in both selector and dropdown
        expect(screen.getAllByText('Arrangement 1').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Arrangement 2')).toBeInTheDocument();
    });

    it('should call switchArrangement when arrangement is clicked', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        const arrangement2 = screen.getAllByTestId('picker-row')[1];
        fireEvent.click(arrangement2);
        expect(switchArrangement).toHaveBeenCalledWith('arr-2');
    });

    it('should have New Arrangement button', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        expect(screen.getByText(/New Arrangement/i)).toBeInTheDocument();
    });

    it('should have Duplicate Current button', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        expect(screen.getByText(/Duplicate Current/i)).toBeInTheDocument();
    });
});
