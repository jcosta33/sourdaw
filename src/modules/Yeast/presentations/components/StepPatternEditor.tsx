/**
 * StepPatternEditor — per-step arp pattern grid.
 *
 * Displays a grid of steps with controls for:
 * - active on/off (click to toggle)
 * - velocity (vertical bar height)
 * - gate (bar width within cell)
 * - octave offset (color/badge)
 * - probability (opacity)
 * - ratchet (subdivisions shown inside cell)
 * - step type and note selector (cycled from the badges below/above the bar)
 *
 * Every field the pattern codec carries is reachable here. A field the codec
 * persists but no gesture can set is dead weight in the document.
 */
import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';

import { type ArpStep, type NoteSelector, type StepType } from '../../models/ArpPattern';

type Props = {
    steps: ArpStep[];
    currentStep: number;
    onStepChange: (index: number, step: ArpStep) => void;
    onLengthChange: (length: number) => void;
};

const STEP_WIDTH = 28;
const STEP_HEIGHT = 60;

/** Cycle order and readout for the step type. `random` re-picks from the pool every pass. */
const STEP_TYPE_CYCLE: readonly { type: StepType; glyph: string; label: string }[] = [
    { type: 'note', glyph: '♪', label: 'Note' },
    { type: 'rest', glyph: '·', label: 'Rest' },
    { type: 'tie', glyph: '~', label: 'Tie' },
    { type: 'chord', glyph: '≡', label: 'Chord' },
    { type: 'random', glyph: '?', label: 'Random' },
];

/** Cycle order and readout for which note of the held chord the step takes. */
const NOTE_SELECTOR_CYCLE: readonly { selector: NoteSelector; glyph: string; label: string }[] = [
    { selector: { type: 'next' }, glyph: '→', label: 'Next' },
    { selector: { type: 'previous' }, glyph: '←', label: 'Previous' },
    { selector: { type: 'lowest' }, glyph: '⌄', label: 'Lowest' },
    { selector: { type: 'highest' }, glyph: '⌃', label: 'Highest' },
    { selector: { type: 'random' }, glyph: '✳', label: 'Random' },
];

export const StepPatternEditor = ({ steps, currentStep, onStepChange, onLengthChange }: Props): ReactElement => {
    const toggleStep = (index: number) => {
        const step = steps[index]!;
        onStepChange(index, { ...step, active: !step.active });
    };

    const setVelocity = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        // A collapsed cell (hidden deck, zero-height layout pass) would divide
        // by zero and carry NaN into the stored pattern.
        if (rect.height <= 0) {
            return;
        }
        const y = 1 - (event.clientY - rect.top) / rect.height;
        const vel = Math.max(1, Math.min(127, Math.round(y * 127)));
        onStepChange(index, { ...steps[index]!, velocity: vel, velocityOverride: true });
    };

    const cycleOctave = (index: number) => {
        const step = steps[index]!;
        const next = step.octaveOffset >= 2 ? -2 : step.octaveOffset + 1;
        onStepChange(index, { ...step, octaveOffset: next });
    };

    const cycleStepType = (index: number) => {
        const step = steps[index]!;
        const current = STEP_TYPE_CYCLE.findIndex((entry) => entry.type === step.stepType);
        const next = STEP_TYPE_CYCLE[(current + 1) % STEP_TYPE_CYCLE.length]!;
        onStepChange(index, { ...step, stepType: next.type });
    };

    const cycleNoteSelector = (index: number) => {
        const step = steps[index]!;
        const current = NOTE_SELECTOR_CYCLE.findIndex((entry) => entry.selector.type === step.noteSelector.type);
        const next = NOTE_SELECTOR_CYCLE[(current + 1) % NOTE_SELECTOR_CYCLE.length]!;
        onStepChange(index, { ...step, noteSelector: next.selector });
    };

    return (
        <Stack gap={1}>
            {/* Step grid */}
            <Row align="stretch" className="gap-px overflow-x-auto pb-1">
                {steps.map((step, index) => {
                    const isPlaying = index === currentStep;
                    const velNorm = step.velocity / 127;
                    const probOpacity = step.probability;
                    const stepFillClass = () => {
                        if (!step.active) {
                            return 'bg-muted-foreground/10';
                        }
                        if (step.stepType === 'rest') {
                            return 'bg-muted-foreground/20';
                        }
                        if (step.stepType === 'tie') {
                            return 'bg-[var(--color-accent-cyan)]/50';
                        }
                        return 'bg-[var(--color-accent-peach)]';
                    };
                    const octaveBadge = () => {
                        if (step.octaveOffset !== 0) {
                            return (
                                <div
                                    className="absolute bottom-0.5 left-0.5 text-[5px] font-bold cursor-pointer"
                                    style={{
                                        color:
                                            step.octaveOffset > 0
                                                ? 'var(--color-accent-cyan)'
                                                : 'var(--color-accent-lavender)',
                                    }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        cycleOctave(index);
                                    }}
                                >
                                    {step.octaveOffset > 0 ? `+${step.octaveOffset}` : step.octaveOffset}
                                </div>
                            );
                        } else {
                            return null;
                        }
                    };

                    const stepTypeEntry =
                        STEP_TYPE_CYCLE.find((entry) => entry.type === step.stepType) ?? STEP_TYPE_CYCLE[0]!;
                    const selectorEntry =
                        NOTE_SELECTOR_CYCLE.find((entry) => entry.selector.type === step.noteSelector.type) ??
                        NOTE_SELECTOR_CYCLE[0]!;

                    return (
                        <div
                            key={index}
                            className={`flex flex-col items-center gap-0 cursor-pointer select-none ${isPlaying ? 'ring-1 ring-[var(--color-accent-peach)]' : ''}`}
                            style={{ width: STEP_WIDTH, opacity: step.active ? probOpacity : 0.2 }}
                        >
                            {/* Which note of the held chord this step takes. */}
                            <button
                                type="button"
                                aria-label={`Step ${index + 1} note selector`}
                                title={`Note selector: ${selectorEntry.label}`}
                                className="text-[6px] leading-none text-muted-foreground/50 hover:text-foreground cursor-pointer"
                                onClick={() => cycleNoteSelector(index)}
                            >
                                {selectorEntry.glyph}
                            </button>
                            {/* Velocity bar. Pointer height sets velocity; the
                                keyboard has no height, so Enter/Space performs the
                                same on/off toggle the right-click gesture does. */}
                            <div
                                role="button"
                                tabIndex={0}
                                aria-label={`Step ${index + 1}`}
                                aria-pressed={step.active}
                                className="relative bg-surface-inset rounded-sm overflow-hidden"
                                style={{ width: STEP_WIDTH - 4, height: STEP_HEIGHT }}
                                onClick={(event) => setVelocity(index, event)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') {
                                        return;
                                    }
                                    event.preventDefault();
                                    toggleStep(index);
                                }}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    toggleStep(index);
                                }}
                            >
                                {/* Fill */}
                                <div
                                    className={`absolute bottom-0 left-0 right-0 rounded-sm transition-all ${stepFillClass()}`}
                                    style={{
                                        height: `${velNorm * 100}%`,
                                        width: `${Math.min(100, step.gateMul * 100)}%`,
                                    }}
                                />

                                {/* Ratchet indicator */}
                                {step.ratchet > 1 ? (
                                    <div className="absolute top-0.5 right-0.5 text-[5px] font-bold text-[var(--color-accent-peach)]">
                                        ×{step.ratchet}
                                    </div>
                                ) : null}

                                {/* Octave badge */}
                                {octaveBadge()}
                            </div>
                            {/* Step number doubles as the step-type cycle. */}
                            <button
                                type="button"
                                aria-label={`Step ${index + 1} type`}
                                title={`Step type: ${stepTypeEntry.label}`}
                                className={`text-[6px] leading-none cursor-pointer hover:text-foreground ${isPlaying ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/40'}`}
                                onClick={() => cycleStepType(index)}
                            >
                                {index + 1}
                                {stepTypeEntry.glyph}
                            </button>
                        </div>
                    );
                })}

                {/* Add step button */}
                <button
                    type="button"
                    className="flex items-center justify-center text-[8px] text-muted-foreground/40 hover:text-muted-foreground border border-dashed border-border/20 rounded cursor-pointer"
                    style={{ width: STEP_WIDTH, height: STEP_HEIGHT }}
                    onClick={() => onLengthChange(steps.length + 1)}
                >
                    +
                </button>
            </Row>
            {/* Length control */}
            <Row gap={2} className="px-1">
                <span className="text-[7px] text-muted-foreground">Steps: {steps.length}</span>
                <button
                    type="button"
                    className="text-[7px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => onLengthChange(Math.max(1, steps.length - 1))}
                >
                    −
                </button>
                <button
                    type="button"
                    className="text-[7px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => onLengthChange(steps.length + 1)}
                >
                    +
                </button>
                {[4, 8, 16, 32].map((len) => (
                    <button
                        key={len}
                        type="button"
                        className={`text-[7px] px-1 rounded cursor-pointer ${steps.length === len ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/50 hover:text-muted-foreground'}`}
                        onClick={() => onLengthChange(len)}
                    >
                        {len}
                    </button>
                ))}
            </Row>
        </Stack>
    );
};
