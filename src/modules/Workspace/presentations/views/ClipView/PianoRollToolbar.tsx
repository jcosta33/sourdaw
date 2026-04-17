/**
 * PianoRoll toolbar — snap, scale, fold, step input, ghost notes,
 * chord mode, paint mode, lasso mode, and zoom controls.
 */
import { type ReactElement } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/utils/Styles/cn';
import { SCALES, SCALE_ROOT_LABELS } from '../../helpers/pianoRollConstants';
import { CHORD_TYPE_KEYS } from '#/modules/MIDI/useCases';

const ToolbarDivider = (): ReactElement => (
    <div
        className="w-px h-4 mx-1"
        style={{
            background:
                'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)',
        }}
    />
);

type PianoRollChordType =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

type ClipOption = { id: string; name: string };

type PianoRollToolbarProps = {
    gridSnap: number;
    onGridSnapChange: (v: number) => void;
    scaleRoot: number;
    onScaleRootChange: (v: number) => void;
    scaleType: string;
    onScaleTypeChange: (v: string) => void;
    isFolded: boolean;
    onToggleFolded: () => void;
    constrainToScale: boolean;
    onToggleConstrainToScale: () => void;
    stepInput: boolean;
    onToggleStepInput: () => void;
    showGhostNotes: boolean;
    onToggleGhostNotes: () => void;
    chordMode: boolean;
    onToggleChordMode: () => void;
    chordType: PianoRollChordType;
    onChordTypeChange: (v: PianoRollChordType) => void;
    paintMode: boolean;
    onTogglePaintMode: () => void;
    lassoMode: boolean;
    onToggleLassoMode: () => void;
    notePreviewEnabled: boolean;
    onToggleNotePreview: () => void;
    zoom: number;
    onZoomChange: (v: number) => void;
    /** A9: when multiple clips are open, show a selector for which clip receives new notes */
    openedClips?: ClipOption[];
    focusedClipId?: string;
    onFocusedClipIdChange?: (id: string) => void;
    /** I4: Expression View toggle */
    showExpressionView?: boolean;
    onToggleExpressionView?: () => void;
    activeExpressionLane?: 'velocity' | 'pressure' | 'slide' | 'pitchBend';
    onActiveExpressionLaneChange?: (lane: 'velocity' | 'pressure' | 'slide' | 'pitchBend') => void;
};

export const PianoRollToolbar = ({
    gridSnap,
    onGridSnapChange,
    scaleRoot,
    onScaleRootChange,
    scaleType,
    onScaleTypeChange,
    isFolded,
    onToggleFolded,
    constrainToScale,
    onToggleConstrainToScale,
    stepInput,
    onToggleStepInput,
    showGhostNotes,
    onToggleGhostNotes,
    chordMode,
    onToggleChordMode,
    chordType,
    onChordTypeChange,
    paintMode,
    onTogglePaintMode,
    lassoMode,
    onToggleLassoMode,
    notePreviewEnabled,
    onToggleNotePreview,
    zoom,
    onZoomChange,
    openedClips,
    focusedClipId,
    onFocusedClipIdChange,
    showExpressionView,
    onToggleExpressionView,
    activeExpressionLane,
    onActiveExpressionLaneChange,
}: PianoRollToolbarProps): ReactElement => (
    <DawControlStrip>
        <span className="text-[10px] text-muted-foreground">Snap:</span>
        {[1, 0.5, 0.25, 0.125].map((v) => (
            <Button
                key={v}
                variant={gridSnap === v ? 'secondary' : 'ghost'}
                size="icon-xs"
                onClick={() => onGridSnapChange(v)}
                className="text-[9px] w-6 h-5"
            >
                {v === 1 ? '1' : v === 0.5 ? '1/2' : v === 0.25 ? '1/4' : '1/8'}
            </Button>
        ))}

        <ToolbarDivider />

        <span className="text-[10px] text-muted-foreground">Scale:</span>
        <DawCompactSelect
            value={scaleRoot}
            onChange={(e) => onScaleRootChange(Number(e.target.value))}
            size="micro"
            aria-label="Scale root note"
        >
            {SCALE_ROOT_LABELS.map((label, i) => (
                <option key={label} value={i}>
                    {label}
                </option>
            ))}
        </DawCompactSelect>
        <DawCompactSelect
            value={scaleType}
            onChange={(e) => onScaleTypeChange(e.target.value)}
            size="micro"
            aria-label="Scale type"
        >
            {Object.keys(SCALES).map((key) => (
                <option key={key} value={key}>
                    {key}
                </option>
            ))}
        </DawCompactSelect>

        <Button
            variant={isFolded ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleFolded}
            className={cn(
                'text-[10px] px-2',
                isFolded && 'text-[var(--color-accent-cyan)] border-[var(--color-accent-cyan)]/30'
            )}
            aria-pressed={isFolded}
            aria-label="Toggle fold to scale"
        >
            Fold
        </Button>

        <Button
            variant={constrainToScale ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleConstrainToScale}
            className={cn(
                'text-[10px] px-2',
                constrainToScale && 'text-[var(--color-accent-cyan)] border-[var(--color-accent-cyan)]/30'
            )}
            aria-pressed={constrainToScale}
            aria-label="Constrain notes to scale"
        >
            Constrain
        </Button>

        <ToolbarDivider />

        <Button
            variant={stepInput ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleStepInput}
            className={cn(
                'text-[10px] px-2',
                stepInput && 'text-[var(--color-accent-lavender)] border-[var(--color-accent-lavender)]/30'
            )}
            aria-pressed={stepInput}
            aria-label="Toggle step input mode"
        >
            Step
        </Button>

        <ToolbarDivider />

        <Button
            variant={showGhostNotes ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleGhostNotes}
            className={cn(
                'text-[10px] px-2',
                showGhostNotes && 'text-[var(--color-accent-lavender)] border-[var(--color-accent-lavender)]/30'
            )}
            aria-pressed={showGhostNotes}
            aria-label="Toggle ghost notes"
        >
            Ghost
        </Button>

        <Button
            variant={notePreviewEnabled ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleNotePreview}
            className={cn(
                'text-[10px] px-2',
                notePreviewEnabled && 'text-[var(--color-accent-lavender)] border-[var(--color-accent-lavender)]/30'
            )}
            aria-pressed={notePreviewEnabled}
            aria-label="Toggle note hover preview"
        >
            Preview
        </Button>

        <Button
            variant={chordMode ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleChordMode}
            className={cn(
                'text-[10px] px-2',
                chordMode && 'text-[var(--color-accent-mint)] border-[var(--color-accent-mint)]/30'
            )}
            aria-pressed={chordMode}
            aria-label="Toggle chord stamp mode"
        >
            Chord
        </Button>

        {chordMode ? (
            <DawCompactSelect
                value={chordType}
                onChange={(e) => onChordTypeChange(e.target.value as PianoRollChordType)}
                size="micro"
                aria-label="Chord type"
            >
                {CHORD_TYPE_KEYS.map((key) => (
                    <option key={key} value={key}>
                        {key}
                    </option>
                ))}
            </DawCompactSelect>
        ) : null}

        <Button
            variant={paintMode ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onTogglePaintMode}
            className={cn(
                'text-[10px] px-2',
                paintMode && 'text-[var(--color-accent-peach)] border-[var(--color-accent-peach)]/30'
            )}
            aria-pressed={paintMode}
            aria-label="Toggle paint mode"
        >
            Paint
        </Button>

        <Button
            variant={lassoMode ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleLassoMode}
            className={cn(
                'text-[10px] px-2',
                lassoMode && 'text-[var(--color-accent-lavender)] border-[var(--color-accent-lavender)]/30'
            )}
            aria-pressed={lassoMode}
            aria-label="Toggle magic lasso selection"
        >
            Lasso
        </Button>

        <ToolbarDivider />

        <Button
            variant={showExpressionView ? 'secondary' : 'ghost'}
            size="xs"
            onClick={onToggleExpressionView}
            className={cn(
                'text-[10px] px-2',
                showExpressionView && 'text-[var(--color-accent-cyan)] border-[var(--color-accent-cyan)]/30'
            )}
            aria-pressed={showExpressionView}
            aria-label="Toggle Expression View (I4)"
        >
            Expression
        </Button>

        {showExpressionView && activeExpressionLane !== undefined && onActiveExpressionLaneChange !== undefined ? (
            <DawCompactSelect
                value={activeExpressionLane}
                onChange={(e) => onActiveExpressionLaneChange(e.target.value as 'velocity' | 'pressure' | 'slide' | 'pitchBend')}
                size="micro"
                aria-label="Active expression lane"
            >
                <option value="velocity">Velocity</option>
                <option value="pressure">Pressure (MPE)</option>
                <option value="slide">Slide (MPE)</option>
                <option value="pitchBend">Pitch Bend (MPE)</option>
            </DawCompactSelect>
        ) : null}

        {openedClips && openedClips.length > 1 && focusedClipId !== undefined && onFocusedClipIdChange !== undefined ? (
            <>
                <ToolbarDivider />
                <span className="text-[10px] text-muted-foreground">Edit:</span>
                <DawCompactSelect
                    value={focusedClipId}
                    onChange={(e) => onFocusedClipIdChange(e.target.value)}
                    size="micro"
                    aria-label="Focused clip for note input"
                >
                    {openedClips.map((clip) => (
                        <option key={clip.id} value={clip.id}>
                            {clip.name}
                        </option>
                    ))}
                </DawCompactSelect>
            </>
        ) : null}

        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">Zoom:</span>
        <Slider
            value={[zoom * 100]}
            onValueChange={([v]) => {
                if (v !== undefined) {
                    onZoomChange(v / 100);
                }
            }}
            min={25}
            max={400}
            step={25}
            className="w-20"
            aria-label="Piano roll zoom"
        />
    </DawControlStrip>
);
