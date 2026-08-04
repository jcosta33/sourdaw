import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TempoEditor } from '../TempoEditor';

const mockState = {
    transport: {
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    },
    effectiveTempo: 120,
    tempoGovernedByMap: false,
    setTempoValue: vi.fn(),
    mapOpen: false,
    setMapOpen: vi.fn(),
    handleTapTempo: vi.fn(),
    editingTimeSig: false,
    numValue: '4',
    denValue: '4',
    setNumValue: vi.fn(),
    setDenValue: vi.fn(),
    startTimeSigEdit: vi.fn(),
    commitTimeSig: vi.fn(),
    cancelTimeSigEdit: vi.fn(),
    mapPanelRef: { current: null },
    newBeat: '',
    setNewBeat: vi.fn(),
    newTempo: '',
    setNewTempo: vi.fn(),
    newCurve: 'instant' as 'instant' | 'linear',
    setNewCurve: vi.fn(),
    editingChangeId: null as string | null,
    editingChangeTempo: '',
    setEditingChangeTempo: vi.fn(),
    handleAddTempoChange: vi.fn(),
    startEditChange: vi.fn(),
    commitEditChange: vi.fn(),
    cancelEditChange: vi.fn(),
    removeChange: vi.fn(),
    tempoMap: { changes: [] as { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }[] },
};

// Mock hooks
vi.mock('../../hooks/useTempoEditorState', () => ({
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
            onChange={(event) => onChange(parseFloat(event.target.value))}
        />
    ),
}));

describe('TempoEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockState.mapOpen = false;
        mockState.editingTimeSig = false;
        mockState.numValue = '4';
        mockState.denValue = '4';
        mockState.editingChangeId = null;
        mockState.editingChangeTempo = '';
        mockState.newBeat = '';
        mockState.newTempo = '';
        mockState.newCurve = 'instant';
        mockState.tempoMap = { changes: [] };
        mockState.transport.tempo = 120;
        mockState.effectiveTempo = 120;
        mockState.tempoGovernedByMap = false;
    });

    it('should render current tempo and time signature', () => {
        render(<TempoEditor />);
        expect(screen.getByTestId('tempo-input')).toHaveValue(120);
        expect(screen.getByText('4/4')).toBeInTheDocument();
        expect(screen.getByLabelText('Tempo BPM')).toBeInTheDocument();
    });

    it('should read out the map-governed tempo, not the inert base tempo', () => {
        mockState.tempoMap = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
        mockState.transport.tempo = 120;
        mockState.effectiveTempo = 90;
        mockState.tempoGovernedByMap = true;

        render(<TempoEditor />);

        expect(screen.getByTestId('tempo-input')).toHaveValue(90);
        expect(screen.getByLabelText('Tempo BPM at playhead (tempo map)')).toBeInTheDocument();
        expect(screen.queryByLabelText('Tempo BPM')).toBeNull();
        expect(
            screen.getByText('Tempo at the playhead. Editing changes the tempo-map event that governs it.')
        ).toBeInTheDocument();
    });

    it('should still commit edits through setTempoValue while the map governs', () => {
        mockState.tempoMap = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
        mockState.effectiveTempo = 90;
        mockState.tempoGovernedByMap = true;

        render(<TempoEditor />);
        fireEvent.change(screen.getByTestId('tempo-input'), { target: { value: '128' } });

        expect(mockState.setTempoValue).toHaveBeenCalledWith(128);
    });

    it('should call handleTapTempo when TAP is clicked', () => {
        render(<TempoEditor />);
        const tapButton = screen.getByText('TAP');
        fireEvent.click(tapButton);

        expect(mockState.handleTapTempo).toHaveBeenCalled();
    });

    it('should toggle tempo map when map button is clicked', () => {
        render(<TempoEditor />);
        const mapButton = screen.getByLabelText('Toggle tempo map');
        fireEvent.click(mapButton);

        expect(mockState.setMapOpen).toHaveBeenCalledWith(true);
    });

    it('should call startTimeSigEdit when time signature is clicked', () => {
        render(<TempoEditor />);
        const timeSigButton = screen.getByText('4/4');
        fireEvent.click(timeSigButton);

        expect(mockState.startTimeSigEdit).toHaveBeenCalled();
    });

    it('should render time signature edit inputs and call setNumValue/setDenValue on change', () => {
        mockState.editingTimeSig = true;
        mockState.numValue = '3';
        mockState.denValue = '8';
        render(<TempoEditor />);

        const numeratorInput = screen.getByLabelText('Time signature numerator');
        expect(numeratorInput).toHaveValue(3);
        fireEvent.change(numeratorInput, { target: { value: '5' } });
        expect(mockState.setNumValue).toHaveBeenCalledWith('5');

        const denominatorSelect = screen.getByLabelText('Time signature denominator');
        expect(denominatorSelect).toHaveValue('8');
        fireEvent.change(denominatorSelect, { target: { value: '16' } });
        expect(mockState.setDenValue).toHaveBeenCalledWith('16');
    });

    it('should commit time signature on Enter and cancel on Escape', () => {
        mockState.editingTimeSig = true;
        render(<TempoEditor />);
        const numeratorInput = screen.getByLabelText('Time signature numerator');

        fireEvent.keyDown(numeratorInput, { key: 'Enter' });
        expect(mockState.commitTimeSig).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(numeratorInput, { key: 'Escape' });
        expect(mockState.cancelTimeSigEdit).toHaveBeenCalledTimes(1);
    });

    it('should commit time signature when the denominator select loses focus', () => {
        mockState.editingTimeSig = true;
        render(<TempoEditor />);
        fireEvent.blur(screen.getByLabelText('Time signature denominator'));
        expect(mockState.commitTimeSig).toHaveBeenCalledTimes(1);
    });

    it('should render "No tempo changes" when the map is open and empty', () => {
        mockState.mapOpen = true;
        render(<TempoEditor />);
        expect(screen.getByText('No tempo changes')).toBeInTheDocument();
    });

    it('should render tempo change rows and start editing when the tempo is clicked', () => {
        mockState.mapOpen = true;
        mockState.tempoMap = { changes: [{ id: 'c1', beat: 4, tempo: 140, curve: 'linear' }] };
        render(<TempoEditor />);

        expect(screen.getByText('Beat 4')).toBeInTheDocument();
        const tempoButton = screen.getByLabelText('140 BPM at beat 4. Click to edit.');
        fireEvent.click(tempoButton);
        expect(mockState.startEditChange).toHaveBeenCalledWith(mockState.tempoMap.changes[0]);
    });

    it('should style the curve badge differently for linear vs instant curve types', () => {
        mockState.mapOpen = true;
        mockState.tempoMap = {
            changes: [
                { id: 'c1', beat: 4, tempo: 140, curve: 'linear' },
                { id: 'c2', beat: 8, tempo: 150, curve: 'instant' },
            ],
        };
        render(<TempoEditor />);

        const linearBadge = screen.getAllByText('linear').find((element) => element.tagName === 'SPAN');
        const instantBadge = screen.getAllByText('instant').find((element) => element.tagName === 'SPAN');
        expect(linearBadge).toHaveClass('text-[var(--color-accent-cyan)]');
        expect(instantBadge).toHaveClass('bg-muted');
    });

    it('should remove a tempo change when the trash button is clicked', () => {
        mockState.mapOpen = true;
        mockState.tempoMap = { changes: [{ id: 'c1', beat: 4, tempo: 140, curve: 'linear' }] };
        render(<TempoEditor />);

        fireEvent.click(screen.getByLabelText('Remove tempo change at beat 4'));
        expect(mockState.removeChange).toHaveBeenCalledWith('c1');
    });

    it('should render an editable input for the change being edited and commit/cancel it', () => {
        mockState.mapOpen = true;
        mockState.editingChangeId = 'c1';
        mockState.editingChangeTempo = '145';
        mockState.tempoMap = { changes: [{ id: 'c1', beat: 4, tempo: 140, curve: 'linear' }] };
        render(<TempoEditor />);

        const editInput = screen.getByLabelText('Edit tempo at beat 4');
        expect(editInput).toHaveValue(145);

        fireEvent.change(editInput, { target: { value: '150' } });
        expect(mockState.setEditingChangeTempo).toHaveBeenCalledWith('150');

        fireEvent.keyDown(editInput, { key: 'Enter' });
        expect(mockState.commitEditChange).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(editInput, { key: 'Escape' });
        expect(mockState.cancelEditChange).toHaveBeenCalledTimes(1);

        fireEvent.blur(editInput);
        expect(mockState.commitEditChange).toHaveBeenCalledTimes(2);
    });

    it('should call the new tempo change setters and handleAddTempoChange', () => {
        mockState.mapOpen = true;
        render(<TempoEditor />);

        fireEvent.change(screen.getByLabelText('New tempo change beat'), { target: { value: '16' } });
        expect(mockState.setNewBeat).toHaveBeenCalledWith('16');

        fireEvent.change(screen.getByLabelText('New tempo change BPM'), { target: { value: '128' } });
        expect(mockState.setNewTempo).toHaveBeenCalledWith('128');

        fireEvent.change(screen.getByLabelText('New tempo change curve type'), { target: { value: 'linear' } });
        expect(mockState.setNewCurve).toHaveBeenCalledWith('linear');

        fireEvent.click(screen.getByLabelText('Add tempo change'));
        expect(mockState.handleAddTempoChange).toHaveBeenCalledTimes(1);
    });
});
