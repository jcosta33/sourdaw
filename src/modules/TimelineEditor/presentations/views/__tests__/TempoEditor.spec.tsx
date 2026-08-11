import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TempoEditor } from '../TempoEditor';

const mockState = {
    transport: {
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    },
    tempoField: {
        tempo: 120,
        governedByMap: false,
        editable: true,
        lockReason: null as 'tempo-ramp' | 'no-transport-state' | null,
        minTempo: 20,
        maxTempo: 300,
    },
    setTempoValue: vi.fn(),
    resetTempoValue: null as (() => void) | null,
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

type MockValueFieldProps = {
    value: number;
    onChange: (value: number) => void;
    onReset?: () => void;
    readOnly?: boolean;
    min?: number;
    max?: number;
    commitMode?: 'live' | 'release';
    ariaLabel?: string;
    ariaDescribedBy?: string;
};

// The accessible name is rendered onto the control itself. A name the view puts
// on a wrapper instead would leave this input anonymous, which is the state the
// review found: `aria-label` on a role-less div has no ARIA mapping.
vi.mock('#/components/daw/ValueField', () => ({
    ValueField: ({
        value,
        onChange,
        onReset,
        readOnly,
        min,
        max,
        commitMode,
        ariaLabel,
        ariaDescribedBy,
    }: MockValueFieldProps) => (
        <input
            type="number"
            data-testid="tempo-input"
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            value={value}
            readOnly={readOnly}
            min={min}
            max={max}
            data-commit-mode={commitMode}
            data-has-reset={onReset === undefined ? 'no' : 'yes'}
            onChange={(event) => onChange(parseFloat(event.target.value))}
            onDoubleClick={() => onReset?.()}
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
        mockState.tempoField = {
            tempo: 120,
            governedByMap: false,
            editable: true,
            lockReason: null,
            minTempo: 20,
            maxTempo: 300,
        };
        mockState.resetTempoValue = null;
    });

    const mapGovernedField = {
        tempo: 90,
        governedByMap: true,
        editable: true,
        lockReason: null as 'tempo-ramp' | 'no-transport-state' | null,
        minTempo: 20,
        maxTempo: 999,
    };

    it('should render current tempo and time signature', () => {
        render(<TempoEditor />);
        expect(screen.getByTestId('tempo-input')).toHaveValue(120);
        expect(screen.getByText('4/4')).toBeInTheDocument();
        expect(screen.getByLabelText('Tempo BPM')).not.toHaveAccessibleDescription();
    });

    it('should read out the map-governed tempo, not the inert base tempo', () => {
        mockState.tempoMap = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
        mockState.transport.tempo = 120;
        mockState.tempoField = mapGovernedField;

        render(<TempoEditor />);

        expect(screen.getByTestId('tempo-input')).toHaveValue(90);
        expect(screen.getByLabelText('Tempo BPM')).toHaveAccessibleDescription(
            'Tempo at the playhead. Editing changes the tempo-map event that governs it.'
        );
        expect(
            screen.getAllByText('Tempo at the playhead. Editing changes the tempo-map event that governs it.')
        ).toHaveLength(2);
    });

    it('should still commit edits through setTempoValue while the map governs', () => {
        mockState.tempoMap = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
        mockState.tempoField = mapGovernedField;

        render(<TempoEditor />);
        fireEvent.change(screen.getByTestId('tempo-input'), { target: { value: '128' } });

        expect(mockState.setTempoValue).toHaveBeenCalledWith(128);
    });

    it('should clamp to the tempo-map range, not the base range, while a map governs', () => {
        mockState.tempoField = mapGovernedField;

        render(<TempoEditor />);

        // A tempo-map change legally holds 400 BPM; a max of 300 would let one
        // pixel of drag narrow it to 300 before onChange ever fired.
        expect(screen.getByTestId('tempo-input')).toHaveAttribute('max', '999');
        expect(screen.getByTestId('tempo-input')).toHaveAttribute('min', '20');
    });

    it('should commit on release so a drag is one history entry, not one per pixel', () => {
        render(<TempoEditor />);

        expect(screen.getByTestId('tempo-input')).toHaveAttribute('data-commit-mode', 'release');
    });

    it('should make the field read-only inside a tempo ramp and say why', () => {
        mockState.tempoField = { ...mapGovernedField, tempo: 110, editable: false, lockReason: 'tempo-ramp' };

        render(<TempoEditor />);

        expect(screen.getByTestId('tempo-input')).toHaveValue(110);
        expect(screen.getByTestId('tempo-input')).toHaveAttribute('readonly');
        expect(screen.getByLabelText('Tempo BPM')).toHaveAccessibleDescription(
            'The playhead is inside a tempo ramp. Edit its end points in the tempo map.'
        );
        // The field description and both tooltips name the reason — TAP used to
        // keep offering "Tap to set tempo" while refusing.
        expect(
            screen.getAllByText('The playhead is inside a tempo ramp. Edit its end points in the tempo map.')
        ).toHaveLength(3);
        expect(screen.queryByText('Tap to set tempo')).toBeNull();
    });

    it('should make the field read-only before the transport state arrives and say why', () => {
        mockState.tempoField = {
            ...mapGovernedField,
            editable: false,
            lockReason: 'no-transport-state',
        };

        render(<TempoEditor />);

        expect(screen.getByTestId('tempo-input')).toHaveAttribute('readonly');
        expect(screen.getByLabelText('Tempo BPM')).toHaveAccessibleDescription(
            'The transport state has not loaded yet.'
        );
        expect(screen.getAllByText('The transport state has not loaded yet.')).toHaveLength(3);
        expect(screen.getByTestId('tempo-lock-reason')).toHaveTextContent('loading');
    });

    it('should name the field on the control itself, not on a wrapper ARIA ignores', () => {
        render(<TempoEditor />);

        expect(screen.getByLabelText('Tempo BPM')).toBe(screen.getByTestId('tempo-input'));
    });

    it('should render the lock reason as visible text, not only inside a hover tooltip', () => {
        // The tooltip is hover-only: unreachable by touch, and the trigger has no
        // `tabIndex`, so it is unreachable by keyboard too. Drives between the two
        // states — no badge when the field is editable, a named badge when locked.
        const { unmount } = render(<TempoEditor />);
        expect(screen.queryByTestId('tempo-lock-reason')).toBeNull();
        unmount();

        mockState.tempoField = { ...mapGovernedField, tempo: 110, editable: false, lockReason: 'tempo-ramp' };
        render(<TempoEditor />);

        expect(screen.getByTestId('tempo-lock-reason')).toHaveTextContent('ramp');
    });

    it('should disable TAP while the field is locked instead of leaving it doing nothing', () => {
        // Tap tempo silently early-returned under every lock while still offering
        // its "Tap to set tempo" tooltip.
        mockState.tempoField = { ...mapGovernedField, editable: false, lockReason: 'tempo-ramp' };

        render(<TempoEditor />);
        const tapButton = screen.getByLabelText('Tap tempo');
        expect(tapButton).toBeDisabled();

        fireEvent.click(tapButton);
        expect(mockState.handleTapTempo).not.toHaveBeenCalled();
    });

    it('should keep TAP live while the transport runs, the state tap tempo is most for', () => {
        mockState.tempoField = mapGovernedField;

        render(<TempoEditor />);
        const tapButton = screen.getByLabelText('Tap tempo');
        expect(tapButton).not.toBeDisabled();

        fireEvent.click(tapButton);
        expect(mockState.handleTapTempo).toHaveBeenCalledTimes(1);
    });

    it('should wire no double-click reset when the hook withholds one', () => {
        mockState.tempoField = mapGovernedField;
        mockState.resetTempoValue = null;

        render(<TempoEditor />);
        fireEvent.doubleClick(screen.getByTestId('tempo-input'));

        expect(screen.getByTestId('tempo-input')).toHaveAttribute('data-has-reset', 'no');
        expect(mockState.setTempoValue).not.toHaveBeenCalled();
    });

    it('should route double-click reset through the hook when one is offered', () => {
        const reset = vi.fn();
        mockState.resetTempoValue = reset;

        render(<TempoEditor />);
        fireEvent.doubleClick(screen.getByTestId('tempo-input'));

        expect(reset).toHaveBeenCalledTimes(1);
        // The view must not invent its own 120 — that write bypassed the command
        // layer and overwrote tempo-map events with no history entry.
        expect(mockState.setTempoValue).not.toHaveBeenCalled();
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
