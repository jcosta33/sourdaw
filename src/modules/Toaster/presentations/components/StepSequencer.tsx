import { type ReactElement, useRef, useState } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row } from '#/components/layout';

import { type DrumEngineType, type PadState, type Pattern, type StepCondition } from '../../models/ToasterKit';

type StepSequencerProps = {
    pattern: Pattern;
    pads: PadState[];
    currentStep: number;
    isPlaying: boolean;
    onToggleStep: (padIndex: number, stepIndex: number) => void;
    onSetVelocity: (padIndex: number, stepIndex: number, velocity: number) => void;
    onSetSoundLock?: (padIndex: number, stepIndex: number, engineType: DrumEngineType | null) => void;
    onSetRetrigger?: (padIndex: number, stepIndex: number, count: number) => void;
    onSetCondition?: (padIndex: number, stepIndex: number, condition: StepCondition) => void;
};

const STEP_HEIGHT = 28;

const RATCHET_OPTIONS: Array<{ count: number; label: string }> = [
    { count: 0, label: 'None' },
    { count: 1, label: '2×' },
    { count: 2, label: '3×' },
    { count: 3, label: '4×' },
    { count: 7, label: '8×' },
];

const CONDITION_OPTIONS: StepCondition[] = ['always', 'fill', 'not-fill', 'first', 'not-first'];

const SOUND_LOCK_ENGINES: DrumEngineType[] = [
    'kick-808',
    'snare-808',
    'clap',
    'hihat-closed',
    'hihat-open',
    'rimshot',
    'cowbell',
    'clave',
    'tom-808-low',
    'kick-909',
    'clap-909',
    'hihat-909',
    'fm-perc',
];

export const StepSequencer = ({
    pattern,
    pads,
    currentStep,
    isPlaying,
    onToggleStep,
    onSetVelocity,
    onSetSoundLock,
    onSetRetrigger,
    onSetCondition,
}: StepSequencerProps): ReactElement => {
    const dragRef = useRef<{ padIndex: number; stepIndex: number; startY: number } | null>(null);
    const [menuState, setMenuState] = useState<{
        padIndex: number;
        stepIndex: number;
        x: number;
        y: number;
    } | null>(null);
    const stepCount = pattern.stepsPerBar * pattern.bars;
    const hasContextMenu = Boolean(onSetSoundLock || onSetRetrigger || onSetCondition);

    const targetTrack = menuState ? pattern.tracks.find((track) => track.padIndex === menuState.padIndex) : undefined;
    const targetStep = menuState ? targetTrack?.steps[menuState.stepIndex] : undefined;

    function handleStepPointerDown(
        padIndex: number,
        stepIndex: number,
        event: React.PointerEvent<HTMLDivElement>
    ): void {
        if (event.button !== 0 && event.button !== undefined) {
            return;
        }

        if (event.altKey) {
            dragRef.current = { padIndex, stepIndex, startY: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
        }

        onToggleStep(padIndex, stepIndex);
    }

    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
        if (!dragRef.current) {
            return;
        }

        const delta = dragRef.current.startY - event.clientY;
        const velocity = Math.max(0.05, Math.min(1, 0.5 + delta / 100));
        onSetVelocity(dragRef.current.padIndex, dragRef.current.stepIndex, velocity);
    }

    function handlePointerUp(): void {
        dragRef.current = null;
    }

    return (
        <div className="select-none" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
            <div className="mb-1 px-2 text-[8px] uppercase tracking-[0.18em] text-white/35">
                Click to toggle · Alt-drag a step up/down to set velocity · Right-click or press L to sound-lock engine
            </div>
            {pattern.tracks.map((track) => {
                const pad = pads[track.padIndex];
                if (!pad) {
                    return null;
                }

                return (
                    <Row align="end" gap={2} className="mb-1" key={track.padIndex}>
                        <Row gap={2} shrink={false} className="toaster-step-label h-8 w-[88px] rounded-[14px] px-2">
                            <div className="size-2 rounded-full" style={{ backgroundColor: pad.color }} />
                            <span className="truncate text-[9px] font-medium" style={{ color: `${pad.color}dd` }}>
                                {pad.name}
                            </span>
                        </Row>

                        <Row align="stretch" grow gap={1}>
                            {track.steps.slice(0, stepCount).map((step, stepIndex) => {
                                const isCurrent = isPlaying && stepIndex === currentStep;
                                const isBarStart = stepIndex % 4 === 0;
                                const probabilityTint = step.active ? 0.12 + (1 - step.probability) * 0.18 : 0;

                                let background = 'rgba(255,255,255,0.012)';
                                if (isCurrent) {
                                    background =
                                        'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))';
                                } else if (stepIndex % 8 < 4) {
                                    background = 'rgba(255,255,255,0.02)';
                                }

                                return (
                                    <div
                                        key={stepIndex}
                                        role="checkbox"
                                        tabIndex={0}
                                        aria-checked={step.active}
                                        data-testid={`toaster-step-${track.padIndex}-${stepIndex}`}
                                        aria-label={`${pad.name} step ${stepIndex + 1}${
                                            step.active ? `, on, velocity ${Math.round(step.velocity * 100)}%` : ', off'
                                        }${step.soundLock ? `, sound lock ${step.soundLock}` : ''}${
                                            step.retriggerCount > 0 ? `, ratchet ${step.retriggerCount + 1}x` : ''
                                        }${
                                            step.condition && step.condition !== 'always'
                                                ? `, condition ${step.condition}`
                                                : ''
                                        }`}
                                        title="Click to toggle · Alt-drag up/down to set velocity · Right-click or press L to sound-lock"
                                        className={`relative min-w-[19px] flex-1 cursor-pointer rounded-[10px] transition-all ${isBarStart ? 'ml-1' : ''}`}
                                        style={{
                                            height: STEP_HEIGHT,
                                            background,
                                            boxShadow: isCurrent
                                                ? `0 0 16px ${pad.color}33`
                                                : 'inset 0 1px 0 rgba(255,255,255,0.04)',
                                        }}
                                        onPointerDown={(event) =>
                                            handleStepPointerDown(track.padIndex, stepIndex, event)
                                        }
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            if (hasContextMenu) {
                                                setMenuState({
                                                    padIndex: track.padIndex,
                                                    stepIndex,
                                                    x: event.clientX,
                                                    y: event.clientY,
                                                });
                                            }
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onToggleStep(track.padIndex, stepIndex);
                                            } else if (
                                                event.key === 'l' ||
                                                event.key === 'L' ||
                                                event.key === 'ContextMenu'
                                            ) {
                                                event.preventDefault();
                                                if (hasContextMenu) {
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    setMenuState({
                                                        padIndex: track.padIndex,
                                                        stepIndex,
                                                        x: rect.left,
                                                        y: rect.bottom,
                                                    });
                                                }
                                            }
                                        }}
                                    >
                                        <div className="absolute inset-[1px] rounded-[9px] bg-black/22" />

                                        {step.active ? (
                                            <div
                                                className="absolute bottom-[2px] left-[2px] right-[2px] rounded-[7px] transition-all"
                                                style={{
                                                    height: `${step.velocity * 100}%`,
                                                    background: `linear-gradient(180deg, ${pad.color}, ${pad.color}aa)`,
                                                    opacity: 0.92,
                                                    boxShadow: isCurrent
                                                        ? `0 0 10px ${pad.color}88`
                                                        : `0 0 6px ${pad.color}44`,
                                                }}
                                            />
                                        ) : null}

                                        {step.active && step.soundLock ? (
                                            <span
                                                data-testid={`toaster-step-soundlock-${track.padIndex}-${stepIndex}`}
                                                className="absolute bottom-0.5 left-0.5 right-0.5 pointer-events-none truncate text-center text-[7px] font-bold uppercase leading-none text-white/90 drop-shadow"
                                            >
                                                {step.soundLock.replace('-808', '').replace('-909', ' 909')}
                                            </span>
                                        ) : null}

                                        {step.active && step.condition && step.condition !== 'always' ? (
                                            <span
                                                data-testid={`toaster-step-condition-${track.padIndex}-${stepIndex}`}
                                                className="absolute top-0.5 right-1 pointer-events-none max-w-[26px] truncate text-[6px] font-bold uppercase leading-none text-white/75 drop-shadow"
                                            >
                                                {step.condition}
                                            </span>
                                        ) : null}

                                        {step.active && step.probability < 1 ? (
                                            <div
                                                className="absolute right-1 top-1 size-1.5 rounded-full"
                                                style={{
                                                    backgroundColor: `rgba(255,255,255,${0.18 + probabilityTint})`,
                                                }}
                                            />
                                        ) : null}

                                        {step.active && step.retriggerCount > 0 ? (
                                            <div className="absolute left-1 top-1 text-[5px] font-bold text-white/45">
                                                {step.retriggerCount + 1}×
                                            </div>
                                        ) : null}

                                        {isCurrent ? (
                                            <div className="absolute inset-0 rounded-[10px] border border-white/18" />
                                        ) : null}
                                    </div>
                                );
                            })}
                        </Row>
                    </Row>
                );
            })}

            {menuState && hasContextMenu ? (
                <DawContextMenuSurface
                    backdrop
                    onClose={() => setMenuState(null)}
                    x={menuState.x}
                    y={menuState.y}
                    className="min-w-[160px]"
                    role="menu"
                    aria-label="Step Settings"
                >
                    {onSetRetrigger ? (
                        <>
                            <DawMenuSectionLabel>Ratchets</DawMenuSectionLabel>
                            {RATCHET_OPTIONS.map(({ count, label }) => (
                                <DawMenuButton
                                    key={count}
                                    role="menuitem"
                                    active={targetStep?.retriggerCount === count}
                                    onClick={() => {
                                        onSetRetrigger(menuState.padIndex, menuState.stepIndex, count);
                                        setMenuState(null);
                                    }}
                                >
                                    {label}
                                </DawMenuButton>
                            ))}
                            {onSetCondition || onSetSoundLock ? <DawMenuSeparator /> : null}
                        </>
                    ) : null}

                    {onSetCondition ? (
                        <>
                            <DawMenuSectionLabel>Condition</DawMenuSectionLabel>
                            {CONDITION_OPTIONS.map((cond) => (
                                <DawMenuButton
                                    key={cond}
                                    role="menuitem"
                                    active={targetStep?.condition === cond}
                                    onClick={() => {
                                        onSetCondition(menuState.padIndex, menuState.stepIndex, cond);
                                        setMenuState(null);
                                    }}
                                >
                                    {cond}
                                </DawMenuButton>
                            ))}
                            {onSetSoundLock ? <DawMenuSeparator /> : null}
                        </>
                    ) : null}

                    {onSetSoundLock ? (
                        <>
                            <DawMenuSectionLabel>Sound Lock Engine</DawMenuSectionLabel>
                            {targetStep?.soundLock ? (
                                <>
                                    <DawMenuButton
                                        role="menuitem"
                                        tone="danger"
                                        onClick={() => {
                                            onSetSoundLock(menuState.padIndex, menuState.stepIndex, null);
                                            setMenuState(null);
                                        }}
                                    >
                                        Clear Sound Lock
                                    </DawMenuButton>
                                    <DawMenuSeparator />
                                </>
                            ) : null}
                            {SOUND_LOCK_ENGINES.map((engine) => (
                                <DawMenuButton
                                    key={engine}
                                    role="menuitem"
                                    active={targetStep?.soundLock === engine}
                                    onClick={() => {
                                        onSetSoundLock(menuState.padIndex, menuState.stepIndex, engine);
                                        setMenuState(null);
                                    }}
                                >
                                    {engine}
                                </DawMenuButton>
                            ))}
                        </>
                    ) : null}
                </DawContextMenuSurface>
            ) : null}
        </div>
    );
};
