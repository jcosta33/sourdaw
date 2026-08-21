import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PianoRollToolbar } from '../PianoRollToolbar';

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        value,
        onChange,
        children,
        size,
        'aria-label': ariaLabel,
    }: {
        value: string | number;
        onChange: (e: { target: { value: string } }) => void;
        children: React.ReactNode;
        size: string;
        'aria-label'?: string;
    }) => (
        <select value={value} onChange={onChange} data-size={size} aria-label={ariaLabel}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
        className,
        'aria-pressed': ariaPressed,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
        className?: string;
        'aria-pressed'?: boolean;
        'aria-label'?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            className={className}
            data-variant={variant}
            data-size={size}
            aria-pressed={ariaPressed}
            aria-label={ariaLabel}
        >
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        min,
        max,
        step,
        className,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min: number;
        max: number;
        step: number;
        className?: string;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            aria-label={ariaLabel}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
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

vi.mock('../../../helpers/pianoRollConstants', () => ({
    SCALES: {
        chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        major: [0, 2, 4, 5, 7, 9, 11],
        minor: [0, 2, 3, 5, 7, 8, 10],
    },
    SCALE_ROOT_LABELS: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    CHORD_TYPE_KEYS: ['major', 'minor', 'dim', 'aug', '7', 'maj7', 'min7'],
}));

describe('PianoRollToolbar', () => {
    const defaultProps = {
        gridSnap: 0.25,
        onGridSnapChange: vi.fn(),
        scaleRoot: 0,
        onScaleRootChange: vi.fn(),
        scaleType: 'chromatic',
        onScaleTypeChange: vi.fn(),
        isFolded: false,
        onToggleFolded: vi.fn(),
        stepInput: false,
        onToggleStepInput: vi.fn(),
        showGhostNotes: true,
        onToggleGhostNotes: vi.fn(),
        chordMode: false,
        onToggleChordMode: vi.fn(),
        chordType: 'major' as const,
        onChordTypeChange: vi.fn(),
        paintMode: false,
        onTogglePaintMode: vi.fn(),
        lassoMode: false,
        onToggleLassoMode: vi.fn(),
        zoom: 1,
        onZoomChange: vi.fn(),
        constrainToScale: false,
        onToggleConstrainToScale: vi.fn(),
        notePreviewEnabled: false,
        onToggleNotePreview: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        expect(screen.getByText('Snap:')).toBeInTheDocument();
    });

    it('should render snap buttons', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('1/2')).toBeInTheDocument();
        expect(screen.getByText('1/4')).toBeInTheDocument();
        expect(screen.getByText('1/8')).toBeInTheDocument();
    });

    it('presses the active snap value and leaves the others unpressed', () => {
        render(<PianoRollToolbar {...defaultProps} gridSnap={0.25} />);
        expect(screen.getByRole('button', { name: '1/4' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '1/8' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: '1/2' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('should call onGridSnapChange when snap button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByText('1/4'));
        expect(defaultProps.onGridSnapChange).toHaveBeenCalledWith(0.25);
    });

    it('should render scale selectors', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        expect(screen.getByLabelText('Scale root note')).toBeInTheDocument();
        expect(screen.getByLabelText('Scale type')).toBeInTheDocument();
    });

    it('should call onScaleRootChange when scale root is changed', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.change(screen.getByLabelText('Scale root note'), { target: { value: '4' } });
        expect(defaultProps.onScaleRootChange).toHaveBeenCalledWith(4);
    });

    it('should call onToggleFolded when Fold button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Toggle fold to scale'));
        expect(defaultProps.onToggleFolded).toHaveBeenCalled();
    });

    it('should call onToggleStepInput when Step button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Toggle step input mode'));
        expect(defaultProps.onToggleStepInput).toHaveBeenCalled();
    });

    it('should call onToggleGhostNotes when Ghost button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Toggle ghost notes'));
        expect(defaultProps.onToggleGhostNotes).toHaveBeenCalled();
    });

    it('should call onToggleChordMode when Chord button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Toggle chord stamp mode'));
        expect(defaultProps.onToggleChordMode).toHaveBeenCalled();
    });

    it('should render chord type selector when chord mode is enabled', () => {
        render(<PianoRollToolbar {...defaultProps} chordMode={true} />);
        expect(screen.getByLabelText('Chord type')).toBeInTheDocument();
    });

    it('should call onTogglePaintMode when Paint button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Toggle paint mode'));
        expect(defaultProps.onTogglePaintMode).toHaveBeenCalled();
    });

    it('should call onToggleLassoMode when Lasso button is clicked', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Toggle magic lasso selection'));
        expect(defaultProps.onToggleLassoMode).toHaveBeenCalled();
    });

    it('should render zoom slider', () => {
        render(<PianoRollToolbar {...defaultProps} />);
        expect(screen.getByLabelText('Piano roll zoom')).toBeInTheDocument();
    });

    it('offers the Velocity lane in the Expression view', () => {
        render(
            <PianoRollToolbar
                {...defaultProps}
                showExpressionView={true}
                activeExpressionLane="velocity"
                onActiveExpressionLaneChange={vi.fn()}
            />
        );
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).toContain('velocity');
    });

    it('hides every MPE expression lane when the track instrument sounds none (MD-2)', () => {
        render(
            <PianoRollToolbar
                {...defaultProps}
                showExpressionView={true}
                activeExpressionLane="velocity"
                onActiveExpressionLaneChange={vi.fn()}
                mpeExpressionLanes={[]}
            />
        );
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).not.toContain('pressure');
        expect(values).not.toContain('slide');
        expect(values).not.toContain('pitchBend');
        expect(screen.queryByText('Pressure (MPE)')).not.toBeInTheDocument();
        expect(screen.queryByText('Slide (MPE)')).not.toBeInTheDocument();
        expect(screen.queryByText('Pitch Bend (MPE)')).not.toBeInTheDocument();
    });

    it('offers the MPE expression lanes when the track instrument sounds them (MD-2)', () => {
        render(
            <PianoRollToolbar
                {...defaultProps}
                showExpressionView={true}
                activeExpressionLane="velocity"
                onActiveExpressionLaneChange={vi.fn()}
                mpeExpressionLanes={['pressure', 'slide', 'pitchBend']}
            />
        );
        const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
        expect(values).toContain('pressure');
        expect(values).toContain('slide');
        expect(values).toContain('pitchBend');
    });

    it('reports the selected MPE lane back to the caller', () => {
        const onActiveExpressionLaneChange = vi.fn();
        render(
            <PianoRollToolbar
                {...defaultProps}
                showExpressionView={true}
                activeExpressionLane="velocity"
                onActiveExpressionLaneChange={onActiveExpressionLaneChange}
                mpeExpressionLanes={['pressure', 'slide', 'pitchBend']}
            />
        );
        fireEvent.change(screen.getByLabelText('Active expression lane'), { target: { value: 'slide' } });

        expect(onActiveExpressionLaneChange).toHaveBeenCalledWith('slide');
    });
});
