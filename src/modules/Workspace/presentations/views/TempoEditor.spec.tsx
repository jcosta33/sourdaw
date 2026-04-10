import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TempoEditor } from './TempoEditor';

const mockState = {
    transport: {
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    },
    setTempoValue: vi.fn(),
    mapOpen: false,
    setMapOpen: vi.fn(),
    handleTapTempo: vi.fn(),
    editingTimeSig: false,
    startTimeSigEdit: vi.fn(),
    tempoMap: { changes: [] },
};

// Mock hooks
vi.mock('../hooks/useTempoEditorState', () => ({
    useTempoEditorState: vi.fn(() => mockState),
}));

// Mock child components
vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: any) => <div>{children}</div>,
    TooltipTrigger: ({ children }: any) => <div>{children}</div>,
    TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('#/components/daw/ValueField', () => ({
    ValueField: ({ value, onChange }: any) => (
        <input
            type="number"
            data-testid="tempo-input"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
        />
    ),
}));

describe('TempoEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render current tempo and time signature', () => {
        render(<TempoEditor />);
        expect(screen.getByTestId('tempo-input')).toHaveValue(120);
        expect(screen.getByText('4/4')).toBeInTheDocument();
    });

    it('should call handleTapTempo when TAP is clicked', async () => {
        render(<TempoEditor />);
        const tapButton = screen.getByText('TAP');
        fireEvent.click(tapButton);
        
        expect(mockState.handleTapTempo).toHaveBeenCalled();
    });

    it('should toggle tempo map when map button is clicked', async () => {
        render(<TempoEditor />);
        const mapButton = screen.getByLabelText('Toggle tempo map');
        fireEvent.click(mapButton);
        
        expect(mockState.setMapOpen).toHaveBeenCalledWith(true);
    });

    it('should call startTimeSigEdit when time signature is clicked', async () => {
        render(<TempoEditor />);
        const timeSigButton = screen.getByText('4/4');
        fireEvent.click(timeSigButton);
        
        expect(mockState.startTimeSigEdit).toHaveBeenCalled();
    });
});
