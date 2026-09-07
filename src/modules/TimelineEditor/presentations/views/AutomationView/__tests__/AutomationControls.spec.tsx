import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AutomationModeControl, AutomationAddLaneControl } from '../AutomationControls';

vi.mock('#/components/daw/DawEyebrowLabel', () => ({
    DawEyebrowLabel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <span className={className}>{children}</span>
    ),
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('../../../helpers/automationViewHelpers', () => ({
    AUTOMATION_MODE_CONFIG: {
        read: { label: 'Read', color: '#4ade80', textColor: '#4ade80' },
        touch: { label: 'Touch', color: '#fbbf24', textColor: '#fbbf24' },
        latch: { label: 'Latch', color: '#60a5fa', textColor: '#60a5fa' },
        write: { label: 'Write', color: '#f87171', textColor: '#f87171' },
        off: { label: 'Off', color: '#9ca3af', textColor: '#9ca3af' },
    },
}));

describe('AutomationModeControl', () => {
    const defaultProps = {
        automationMode: 'read' as const,
        laneCount: 2,
        onModeChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationModeControl {...defaultProps} />);
        expect(screen.getByLabelText('Automation mode: read')).toBeInTheDocument();
    });

    it('should display current mode label', () => {
        render(<AutomationModeControl {...defaultProps} />);
        expect(screen.getByText('Read')).toBeInTheDocument();
    });

    it('should display lane count', () => {
        render(<AutomationModeControl {...defaultProps} laneCount={3} />);
        expect(screen.getByText('3 lanes')).toBeInTheDocument();
    });

    it('should display singular lane count', () => {
        render(<AutomationModeControl {...defaultProps} laneCount={1} />);
        expect(screen.getByText('1 lane')).toBeInTheDocument();
    });

    it('should show mode label', () => {
        render(<AutomationModeControl {...defaultProps} />);
        expect(screen.getByText('Mode')).toBeInTheDocument();
    });

    it('should toggle dropdown when button is clicked', () => {
        render(<AutomationModeControl {...defaultProps} />);
        const modeButton = screen.getByLabelText('Automation mode: read');
        fireEvent.click(modeButton);
        expect(screen.getByText('Touch')).toBeInTheDocument();
    });

    // The global shortcut layer gates Delete / Backspace on
    // closest('[role="menu"]') (#3618): without a menu-role ancestor a Delete
    // from inside the open dropdown deletes the arrangement clips behind it.
    it('mode dropdown items sit inside a [role="menu"] surface', () => {
        render(<AutomationModeControl {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Automation mode: read'));

        expect(screen.getByText('Touch').closest('[role="menu"]')).not.toBeNull();
    });
});

describe('AutomationAddLaneControl', () => {
    const defaultProps = {
        params: [
            { id: 'param1', name: 'Parameter 1' },
            { id: 'param2', name: 'Parameter 2' },
        ],
        onAdd: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationAddLaneControl {...defaultProps} />);
        expect(screen.getByText('Add Lane')).toBeInTheDocument();
    });

    it('should toggle dropdown when button is clicked', () => {
        render(<AutomationAddLaneControl {...defaultProps} />);
        const addButton = screen.getByText('Add Lane');
        fireEvent.click(addButton);
        expect(screen.getByText('Parameter 1')).toBeInTheDocument();
    });

    it('add-lane dropdown items sit inside a [role="menu"] surface', () => {
        render(<AutomationAddLaneControl {...defaultProps} />);
        fireEvent.click(screen.getByText('Add Lane'));

        expect(screen.getByText('Parameter 1').closest('[role="menu"]')).not.toBeNull();
    });

    it('should show available count when showAvailableCount is true', () => {
        render(<AutomationAddLaneControl {...defaultProps} showAvailableCount />);
        expect(screen.getByText('2 available')).toBeInTheDocument();
    });

    it('should call onAdd when parameter is selected', () => {
        render(<AutomationAddLaneControl {...defaultProps} />);
        const addButton = screen.getByText('Add Lane');
        fireEvent.click(addButton);
        const paramButton = screen.getByText('Parameter 1');
        fireEvent.click(paramButton);
        expect(defaultProps.onAdd).toHaveBeenCalledWith('param1', 'Parameter 1');
    });
});
