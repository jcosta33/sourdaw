import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { ClipContextMenu } from '#/modules/Arrangement/presentations/views';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    trackStore,
    sanitizeTrackSnapshot,
} from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { PianoRollContextMenu } from '../PianoRollContextMenu';
import { PianoRollToolbar } from '../PianoRollToolbar';

// Quantize-grid label contract shared by all three surfaces (#4801): gridSize
// is beats, labels are note values in 4/4 — a 1-beat grid is the 1/4 note.
// The piano-roll menu's pills, the clip menu's quantize items, and the
// piano-roll toolbar's snap buttons must name the same grid identically, so
// all three surfaces are asserted against this one table and cannot drift.
const QUANTIZE_GRID_LABELS = {
    1: '1/4',
    0.5: '1/8',
    0.25: '1/16',
    0.125: '1/32',
} as const;

type QuantizeGridSize = keyof typeof QUANTIZE_GRID_LABELS;

const QUANTIZE_GRID_SIZES = [1, 0.5, 0.25, 0.125] as const;

// The clip menu offers a subset of the shared table (0.25 and 0.5 beats).
const CLIP_MENU_GRID_SIZES = [0.25, 0.5] as const;

vi.mock('#/components/daw/DawContextMenuSurface', () => ({
    DawContextMenuSurface: ({
        children,
        ref,
    }: {
        children: React.ReactNode;
        ref?: React.RefObject<HTMLDivElement>;
    }) => <div ref={ref}>{children}</div>,
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({
        children,
        onClick,
        disabled,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DawMenuSeparator: () => <hr />,
    DawMenuMutedRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawMenuInlineEditor', () => ({
    DawMenuInlineEditor: () => <div data-testid="inline-editor" />,
}));

vi.mock('#/components/daw/DawSwatchButton', () => ({
    DawSwatchButton: () => <button type="button">swatch</button>,
}));

// The toolbar surface is the only renderer of the radix slider here; neither
// menu imports it, so this mock cannot disturb the menu surfaces.
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

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    getExecutableAppActionEffect: vi.fn(() => null),
    executeAppAction: vi.fn().mockResolvedValue(undefined),
    executeAppActionBatch: vi.fn(),
    pushUndoEntry: vi.fn(),
    executeUserAppAction: vi.fn().mockResolvedValue(undefined),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    isAppActionConflictError: vi.fn(() => false),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    clearUndoHistory: vi.fn(),
    reconcileSessionUndoForProject: vi.fn(),
    generateGroupId: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    removeMidiNote: vi.fn(),
    moveMidiNote: vi.fn(),
    setNoteVelocity: vi.fn(),
    getNotesForClip: vi.fn(() => []),
    setNotesForClip: vi.fn(),
    humanizeNotes: vi.fn(),
    restoreStrumOriginals: vi.fn(),
    strumNotes: vi.fn(),
    restoreGrooveOriginals: vi.fn(),
    applyGrooveToClip: vi.fn(),
    extractGrooveFromClip: vi.fn(),
    snapClipToScale: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    copySelectedNotes: vi.fn(),
    pasteNotes: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: vi.fn(),
    detectKey: vi.fn(),
    describeDetectedKey: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    runAiActionWithToast: vi.fn((action: () => unknown) => {
        void action();
        return Promise.resolve();
    }),
    injectPromptDraft: vi.fn(),
}));

// Real stores (imported through the Arrangement contract barrels), fed a
// sanitized fixture so the clip menu renders its MIDI actions.
const trackStateWithMidiClip = sanitizeTrackSnapshot({
    tracks: [
        {
            id: 'track-1',
            kind: 'midi',
            clips: [
                {
                    id: 'clip-midi',
                    trackId: 'track-1',
                    name: 'MIDI Clip',
                    type: 'midi',
                    startBeat: 0,
                    endBeat: 4,
                },
            ],
        },
    ],
    selectedTrackId: null,
});

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('quantize grid labels', () => {
    const defaultProps = {
        menu: { x: 100, y: 100, beat: 4, pitch: 60 },
        clipId: 'clip-1',
        notes: [] as { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[],
        selectedNoteIds: new Set<string>(),
        onClose: vi.fn(),
        onSelectAll: vi.fn(),
        onClearSelection: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set(trackStateWithMidiClip);
        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipIds: [] });
    });

    it('labels every Quantize pill by note value and dispatches the matching gridSize (#4801)', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);

        for (const gridSize of QUANTIZE_GRID_SIZES) {
            const pills = screen.getAllByText(QUANTIZE_GRID_LABELS[gridSize]);
            expect(pills).toHaveLength(2);
            fireEvent.click(pills[0]!);
            expect(executeUserAppAction).toHaveBeenCalledWith({
                type: 'quantizeNotes',
                payload: { clipId: 'clip-1', gridSize },
            });
        }
    });

    it('labels every Quantize Length pill by note value and dispatches the matching gridSize (#4801)', () => {
        renderWithTooltip(<PianoRollContextMenu {...defaultProps} />);

        for (const gridSize of QUANTIZE_GRID_SIZES) {
            const pills = screen.getAllByText(QUANTIZE_GRID_LABELS[gridSize]);
            fireEvent.click(pills[1]!);
            expect(executeUserAppAction).toHaveBeenCalledWith({
                type: 'quantizeNoteLengths',
                payload: { clipId: 'clip-1', gridSize },
            });
        }
    });

    it('labels the clip menu quantize items with the same note values for the same gridSizes (#4801)', () => {
        render(<ClipContextMenu x={0} y={0} clipId="clip-midi" splitBeat={4} onClose={vi.fn()} />);

        for (const gridSize of CLIP_MENU_GRID_SIZES) {
            fireEvent.click(screen.getByRole('button', { name: `Quantize (${QUANTIZE_GRID_LABELS[gridSize]})` }));
            expect(executeUserAppAction).toHaveBeenCalledWith({
                type: 'quantizeNotes',
                payload: { clipId: 'clip-midi', gridSize },
            });
        }

        fireEvent.click(
            screen.getByRole('button', {
                name: `Quantize Lengths (${QUANTIZE_GRID_LABELS[0.25 satisfies QuantizeGridSize]})`,
            })
        );
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'clip-midi', gridSize: 0.25 },
        });
    });

    it('labels the piano-roll toolbar snap pills with the same note values for the same gridSizes (#4801)', () => {
        const onGridSnapChange = vi.fn();
        renderWithTooltip(
            <PianoRollToolbar
                gridSnap={0.25}
                onGridSnapChange={onGridSnapChange}
                scaleRoot={0}
                onScaleRootChange={vi.fn()}
                scaleType="chromatic"
                onScaleTypeChange={vi.fn()}
                isFolded={false}
                onToggleFolded={vi.fn()}
                constrainToScale={false}
                onToggleConstrainToScale={vi.fn()}
                stepInput={false}
                onToggleStepInput={vi.fn()}
                showGhostNotes={false}
                onToggleGhostNotes={vi.fn()}
                chordMode={false}
                onToggleChordMode={vi.fn()}
                chordType="major"
                onChordTypeChange={vi.fn()}
                paintMode={false}
                onTogglePaintMode={vi.fn()}
                lassoMode={false}
                onToggleLassoMode={vi.fn()}
                notePreviewEnabled={false}
                onToggleNotePreview={vi.fn()}
                zoom={1}
                onZoomChange={vi.fn()}
            />
        );

        for (const gridSize of QUANTIZE_GRID_SIZES) {
            fireEvent.click(screen.getByRole('button', { name: QUANTIZE_GRID_LABELS[gridSize] }));
            expect(onGridSnapChange).toHaveBeenCalledWith(gridSize);
        }
    });
});
