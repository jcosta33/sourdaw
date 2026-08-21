/**
 * PianoRoll toolbar — snap, scale, fold, step input, ghost notes,
 * chord mode, paint mode, lasso mode, and zoom controls.
 */
import { type ReactElement } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { CHORD_TYPE_KEYS } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

import { MPE_EXPRESSION_LANES, type MpeExpressionLane } from '../../helpers/mpeAvailability';
import { SCALES, SCALE_ROOT_LABELS } from '../../helpers/pianoRollConstants';

/** Labels for the MPE expression lanes offered in the Expression view. */
const MPE_LANE_LABELS: Record<MpeExpressionLane, string> = {
    pressure: 'Pressure (MPE)',
    slide: 'Slide (MPE)',
    pitchBend: 'Pitch Bend (MPE)',
};

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
    /**
     * MPE expression lanes the edited track's instrument actually sounds
     * (audit MD-2). Callers pass per-track truth from
     * `getMpeExpressionLanesForDeviceTypes`; omitted, no MPE lane is offered,
     * because a caller that does not know the instrument cannot promise one.
     */
    mpeExpressionLanes?: readonly MpeExpressionLane[];
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
    mpeExpressionLanes = [],
}: PianoRollToolbarProps): ReactElement => (
    <DawControlStrip>
        <span className="text-[10px] text-muted-foreground">Snap:</span>
        {[1, 0.5, 0.25, 0.125].map((value) => {
            const renderIife_11 = () => {
                if (value === 1) {
                    return '1';
                }
                if (value === 0.5) {
                    return '1/2';
                }
                if (value === 0.25) {
                    return '1/4';
                }
                return '1/8';
            };

            return (
                <Button
                    key={value}
                    variant={gridSnap === value ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    onClick={() => onGridSnapChange(value)}
                    className="text-[9px] w-6 h-5"
                    aria-pressed={gridSnap === value}
                >
                    {renderIife_11()}
                </Button>
            );
        })}

        <ToolbarDivider />

        <span className="text-[10px] text-muted-foreground">Scale:</span>
        <DawCompactSelect
            value={scaleRoot}
            onChange={(event) => onScaleRootChange(Number(event.target.value))}
            size="micro"
            aria-label="Scale root note"
            data-testid="toolbar-scale-root"
        >
            {SCALE_ROOT_LABELS.map((label, index) => (
                <option key={label} value={index}>
                    {label}
                </option>
            ))}
        </DawCompactSelect>
        <DawCompactSelect
            value={scaleType}
            onChange={(event) => onScaleTypeChange(event.target.value)}
            size="micro"
            aria-label="Scale type"
            data-testid="toolbar-scale-type"
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
            data-testid="toolbar-fold-to-scale"
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
            data-testid="toolbar-constrain"
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
            data-testid="toolbar-step-input"
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
            data-testid="toolbar-ghost"
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
            data-testid="toolbar-chord"
        >
            Chord
        </Button>

        {chordMode ? (
            <DawCompactSelect
                value={chordType}
                onChange={(event) => onChordTypeChange(event.target.value as PianoRollChordType)}
                size="micro"
                aria-label="Chord type"
                data-testid="toolbar-chord-type"
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
            data-testid="toolbar-paint"
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
            data-testid="toolbar-expression"
        >
            Expression
        </Button>

        {showExpressionView && activeExpressionLane !== undefined && onActiveExpressionLaneChange !== undefined ? (
            <DawCompactSelect
                value={activeExpressionLane}
                onChange={(event) =>
                    onActiveExpressionLaneChange(event.target.value as 'velocity' | 'pressure' | 'slide' | 'pitchBend')
                }
                size="micro"
                aria-label="Active expression lane"
            >
                <option value="velocity">Velocity</option>
                {MPE_EXPRESSION_LANES.filter((lane) => mpeExpressionLanes.includes(lane)).map((lane) => (
                    <option key={lane} value={lane}>
                        {MPE_LANE_LABELS[lane]}
                    </option>
                ))}
            </DawCompactSelect>
        ) : null}

        {openedClips && openedClips.length > 1 && focusedClipId !== undefined && onFocusedClipIdChange !== undefined ? (
            <>
                <ToolbarDivider />
                <span className="text-[10px] text-muted-foreground">Edit:</span>
                <DawCompactSelect
                    value={focusedClipId}
                    onChange={(event) => onFocusedClipIdChange(event.target.value)}
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
            onValueChange={([value]) => {
                if (value !== undefined) {
                    onZoomChange(value / 100);
                }
            }}
            min={25}
            max={400}
            step={25}
            className="w-20"
            aria-label="Piano roll zoom"
            data-testid="toolbar-zoom"
        />
    </DawControlStrip>
);
