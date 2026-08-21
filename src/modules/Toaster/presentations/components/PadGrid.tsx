import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Grid, Row, Stack } from '#/components/layout';

import { type PadState } from '../../models/ToasterKit';

type PadGridProps = {
    pads: PadState[];
    selectedIndex: number;
    onSelectPad: (index: number) => void;
    onTriggerPad: (index: number) => void;
};

export const PadGrid = ({ pads, selectedIndex, onSelectPad, onTriggerPad }: PadGridProps): ReactElement => {
    const [flashingPads, setFlashingPads] = useState<Set<number>>(new Set());
    const flashTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    function triggerFlash(index: number): void {
        setFlashingPads((previous) => new Set(previous).add(index));
        const existingTimer = flashTimers.current.get(index);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        flashTimers.current.set(
            index,
            setTimeout(() => {
                setFlashingPads((previous) => {
                    const next = new Set(previous);
                    next.delete(index);
                    return next;
                });
                flashTimers.current.delete(index);
            }, 120)
        );
    }

    // Prune the pending flash timer for any pad that leaves the rendered list
    // so its deferred callback can't call setFlashingPads for a removed pad
    // (Finding #33). A stale entry left in flashingPads for a departed index is
    // harmless — it is only read for live indices in the render loop below.
    // Effect re-runs whenever the set of live indices changes; the unmount
    // cleanup clears any survivors.
    const liveCount = Math.min(pads.length, 16);
    useEffect(() => {
        for (const [index, timer] of flashTimers.current) {
            if (index >= liveCount) {
                clearTimeout(timer);
                flashTimers.current.delete(index);
            }
        }
    }, [liveCount]);

    useEffect(() => {
        const timers = flashTimers.current;
        return () => {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
        };
    }, []);

    return (
        <Grid cols={4} gap={1.5}>
            {pads.slice(0, 16).map((pad, index) => {
                const isSelected = index === selectedIndex;
                const isFlashing = flashingPads.has(index);
                const baseGlow = isSelected ? `${pad.color}55` : `${pad.color}22`;

                return (
                    <button
                        key={pad.id}
                        type="button"
                        data-testid={`toaster-pad-${index}`}
                        className="relative aspect-square rounded-[16px] border transition-all select-none"
                        aria-label={`Trigger ${pad.name}`}
                        aria-pressed={isSelected}
                        style={{
                            background: isFlashing
                                ? `linear-gradient(180deg, ${pad.color}, rgba(255,255,255,0.16))`
                                : `linear-gradient(180deg, ${pad.color}26, rgba(0,0,0,0.18))`,
                            borderColor: isSelected ? `${pad.color}88` : `${pad.color}33`,
                            boxShadow: isSelected
                                ? `inset 0 1px 0 rgba(255,255,255,0.12), 0 0 22px ${baseGlow}`
                                : `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 12px ${pad.color}12`,
                            transform: isFlashing ? 'scale(0.97)' : 'scale(1)',
                        }}
                        onClick={() => onSelectPad(index)}
                        onMouseDown={(event) => {
                            if (event.button === 0) {
                                onTriggerPad(index);
                                triggerFlash(index);
                            }
                        }}
                        onKeyDown={(event) => {
                            // Enter/Space also selects via the button's native
                            // click; here we add the trigger + flash so keyboard
                            // users get the same activation as a mouse press.
                            if (event.key === 'Enter' || event.key === ' ') {
                                if (event.repeat) {
                                    return;
                                }
                                onTriggerPad(index);
                                triggerFlash(index);
                            }
                        }}
                    >
                        <div className="absolute inset-[1px] rounded-[14px] bg-black/30" />
                        <Stack justify="between" className="relative z-10 h-full px-2 py-2">
                            <Row align="start" justify="between" gap={2}>
                                <span
                                    className="text-[10px] font-semibold leading-tight tracking-[0.02em]"
                                    style={{ color: isFlashing ? '#fff' : `${pad.color}ee` }}
                                >
                                    {pad.name}
                                </span>
                                {pad.chokeGroup > 0 ? (
                                    <span
                                        className="rounded-full border px-1 py-0.5 text-[7px] font-medium text-white/55"
                                        style={{ borderColor: `${pad.color}55` }}
                                    >
                                        C{pad.chokeGroup}
                                    </span>
                                ) : null}
                            </Row>

                            <Stack gap={1}>
                                <Row
                                    justify="between"
                                    gap={2}
                                    className="text-[7px] uppercase tracking-[0.18em] text-white/45"
                                >
                                    <span>{pad.engineType.replace(/^(kick|snare|hihat|modal)-/, '').slice(0, 8)}</span>
                                    <span>{Math.round(pad.volume * 100)}%</span>
                                </Row>
                                <div className="h-1.5 rounded-full bg-white/8">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${Math.round(pad.volume * 100)}%`,
                                            backgroundColor: pad.color,
                                            opacity: isFlashing ? 1 : 0.85,
                                        }}
                                    />
                                </div>
                            </Stack>
                        </Stack>

                        {pad.muted ? (
                            <Row justify="center" className="absolute inset-0 z-20 rounded-[16px] bg-black/56">
                                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/55">
                                    Mute
                                </span>
                            </Row>
                        ) : null}
                    </button>
                );
            })}
        </Grid>
    );
};
