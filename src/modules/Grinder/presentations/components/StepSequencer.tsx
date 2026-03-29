/**
 * Step Sequencer — visual grid with velocity bars.
 * Each step shows velocity as a vertical bar height, not just opacity.
 * Active steps glow with the pad's color. Playback cursor pulses.
 */
import { type ReactElement, useCallback, useRef } from 'react';
import { type Pattern, type PadState } from '../../models/GrinderKit';

type StepSequencerProps = {
    pattern: Pattern;
    pads: PadState[];
    currentStep: number;
    isPlaying: boolean;
    onToggleStep: (padIndex: number, stepIndex: number) => void;
    onSetVelocity: (padIndex: number, stepIndex: number, velocity: number) => void;
};

const STEP_H = 24;

export const StepSequencer = ({
    pattern, pads, currentStep, isPlaying, onToggleStep, onSetVelocity,
}: StepSequencerProps): ReactElement => {
    const numSteps = pattern.stepsPerBar * pattern.bars;
    const dragRef = useRef<{ padIndex: number; stepIndex: number; startY: number } | null>(null);

    const handleStepPointerDown = useCallback((padIndex: number, stepIndex: number, e: React.PointerEvent) => {
        if (e.altKey) {
            // Alt+drag = adjust velocity
            dragRef.current = { padIndex, stepIndex, startY: e.clientY };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } else {
            onToggleStep(padIndex, stepIndex);
        }
    }, [onToggleStep]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current) { return; }
        const delta = dragRef.current.startY - e.clientY;
        const vel = Math.max(0.05, Math.min(1, 0.5 + delta / 100));
        onSetVelocity(dragRef.current.padIndex, dragRef.current.stepIndex, vel);
    }, [onSetVelocity]);

    const handlePointerUp = useCallback(() => {
        dragRef.current = null;
    }, []);

    return (
        <div
            className="select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {/* Pad rows */}
            {pattern.tracks.map((track) => {
                const pad = pads[track.padIndex];
                if (!pad) { return null; }

                return (
                    <div key={track.padIndex} className="flex items-end mb-px">
                        {/* Pad label */}
                        <div className="w-[72px] shrink-0 flex items-center gap-1 px-1 h-7">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pad.color }} />
                            <span className="text-[8px] font-medium truncate" style={{ color: `${pad.color}aa` }}>
                                {pad.name}
                            </span>
                        </div>

                        {/* Steps */}
                        <div className="flex gap-px flex-1">
                            {track.steps.slice(0, numSteps).map((step, s) => {
                                const isCurrent = s === currentStep && isPlaying;
                                const isBarStart = s % 4 === 0;

                                return (
                                    <div
                                        key={s}
                                        className={`relative flex-1 min-w-[18px] rounded-sm cursor-pointer transition-colors ${isBarStart ? 'ml-px' : ''}`}
                                        style={{
                                            height: STEP_H,
                                            backgroundColor: isCurrent
                                                ? 'rgba(255,255,255,0.06)'
                                                : s % 8 < 4
                                                    ? 'rgba(255,255,255,0.015)'
                                                    : 'rgba(255,255,255,0.008)',
                                        }}
                                        onPointerDown={(e) => handleStepPointerDown(track.padIndex, s, e)}
                                    >
                                        {/* Velocity bar — grows from bottom */}
                                        {step.active ? (
                                            <div
                                                className="absolute bottom-0 left-[2px] right-[2px] rounded-t-sm transition-all"
                                                style={{
                                                    height: `${step.velocity * 100}%`,
                                                    backgroundColor: pad.color,
                                                    opacity: 0.8,
                                                    boxShadow: isCurrent ? `0 0 6px ${pad.color}80` : 'none',
                                                }}
                                            />
                                        ) : null}

                                        {/* Probability indicator — dim dot if < 100% */}
                                        {step.active && step.probability < 1 ? (
                                            <div className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-white/30" />
                                        ) : null}

                                        {/* Ratchet indicator */}
                                        {step.active && step.retriggerCount > 0 ? (
                                            <div className="absolute top-0.5 left-0.5 text-[5px] text-white/40 font-bold">
                                                {step.retriggerCount}×
                                            </div>
                                        ) : null}

                                        {/* Playback cursor glow */}
                                        {isCurrent ? (
                                            <div className="absolute inset-0 rounded-sm border border-white/20" />
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
