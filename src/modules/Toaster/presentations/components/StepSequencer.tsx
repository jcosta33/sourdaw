import { type ReactElement, useRef } from 'react';

import { Row } from '#/components/layout';

import { type PadState, type Pattern } from '../../models/ToasterKit';

type StepSequencerProps = {
    pattern: Pattern;
    pads: PadState[];
    currentStep: number;
    isPlaying: boolean;
    onToggleStep: (padIndex: number, stepIndex: number) => void;
    onSetVelocity: (padIndex: number, stepIndex: number, velocity: number) => void;
};

const STEP_HEIGHT = 28;

export const StepSequencer = ({
    pattern,
    pads,
    currentStep,
    isPlaying,
    onToggleStep,
    onSetVelocity,
}: StepSequencerProps): ReactElement => {
    const dragRef = useRef<{ padIndex: number; stepIndex: number; startY: number } | null>(null);
    const stepCount = pattern.stepsPerBar * pattern.bars;

    function handleStepPointerDown(
        padIndex: number,
        stepIndex: number,
        event: React.PointerEvent<HTMLDivElement>
    ): void {
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
                Click to toggle · Alt-drag a step up/down to set velocity
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
                                        }`}
                                        title="Click to toggle · Alt-drag up/down to set velocity"
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
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onToggleStep(track.padIndex, stepIndex);
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
                                                {step.retriggerCount}×
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
        </div>
    );
};
