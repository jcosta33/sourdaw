/**
 * Pad Grid — 4×4 interactive pads.
 * Each pad shows: name, engine type, color accent, and flashes on trigger.
 * Click to select. Click+hold or mousedown to trigger (play the sound).
 */
import { type ReactElement, useCallback, useState, useEffect, useRef } from 'react';
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

    const triggerFlash = useCallback((index: number) => {
        setFlashingPads((prev) => new Set(prev).add(index));
        const existing = flashTimers.current.get(index);
        if (existing) { clearTimeout(existing); }
        flashTimers.current.set(index, setTimeout(() => {
            setFlashingPads((prev) => {
                const next = new Set(prev);
                next.delete(index);
                return next;
            });
            flashTimers.current.delete(index);
        }, 120));
    }, []);

    useEffect(() => {
        return () => {
            for (const timer of flashTimers.current.values()) { clearTimeout(timer); }
        };
    }, []);

    return (
        <div className="grid grid-cols-4 gap-[3px]">
            {pads.slice(0, 16).map((pad, i) => {
                const isSelected = i === selectedIndex;
                const isFlashing = flashingPads.has(i);

                return (
                    <button
                        key={pad.id}
                        type="button"
                        className="relative flex flex-col items-center justify-center rounded transition-all aspect-square select-none"
                        style={{
                            backgroundColor: isFlashing
                                ? pad.color
                                : isSelected
                                    ? `${pad.color}30`
                                    : `${pad.color}12`,
                            boxShadow: isSelected ? `inset 0 0 0 1.5px ${pad.color}60` : 'none',
                            transform: isFlashing ? 'scale(0.95)' : 'scale(1)',
                        }}
                        onClick={() => onSelectPad(i)}
                        onMouseDown={(e) => {
                            if (e.button === 0) {
                                onTriggerPad(i);
                                triggerFlash(i);
                            }
                        }}
                    >
                        {/* Pad name */}
                        <span
                            className="text-[8px] font-semibold leading-tight truncate w-full text-center px-0.5"
                            style={{ color: isFlashing ? '#fff' : `${pad.color}cc` }}
                        >
                            {pad.name}
                        </span>

                        {/* Engine type hint */}
                        <span className="text-[6px] text-muted-foreground/40 leading-tight">
                            {pad.engineType.replace(/^(kick|snare|hihat|modal)-/, '').slice(0, 6)}
                        </span>

                        {/* Choke group indicator */}
                        {pad.chokeGroup > 0 ? (
                            <div
                                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full border"
                                style={{ borderColor: `${pad.color}50` }}
                            />
                        ) : null}

                        {/* Muted overlay */}
                        {pad.muted ? (
                            <div className="absolute inset-0 rounded bg-black/50 flex items-center justify-center">
                                <span className="text-[7px] font-bold text-white/50">M</span>
                            </div>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
};
