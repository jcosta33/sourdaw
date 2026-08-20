/**
 * CrustGainStrip — the left vertical "push" slider.
 * Pointer-capture based, no drag events — smooth cross-platform.
 * Ctrl/Cmd = fine-mode (0.1× sensitivity).
 */
import { type ReactElement, type KeyboardEvent, useRef } from 'react';

import { Row, Stack } from '#/components/layout';

type Props = {
    value: number; // 0 – 18 dB
    onChange: (v: number) => void;
};

const MIN = 0;
const MAX = 18;

function norm(v: number): number {
    return Math.max(0, Math.min(1, v / MAX));
}
function clamp(v: number): number {
    return Math.max(MIN, Math.min(MAX, v));
}

export const CrustGainStrip = ({ value, onChange }: Props): ReactElement => {
    const trackRef = useRef<HTMLDivElement>(null);
    const drag = useRef({ active: false, startY: 0, startValue: 0 });

    function handlePointerDown(e: React.PointerEvent): void {
        drag.current = { active: true, startY: e.clientY, startValue: value };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: React.PointerEvent): void {
        if (!drag.current.active || !trackRef.current) {
            return;
        }
        const trackH = trackRef.current.getBoundingClientRect().height;
        const dy = drag.current.startY - e.clientY; // upward = more gain
        const scale = e.ctrlKey || e.metaKey ? 0.1 : 1;
        const delta = (dy / trackH) * MAX * scale;
        onChange(clamp(drag.current.startValue + delta));
    }

    function handlePointerUp(): void {
        drag.current.active = false;
    }

    function handleKeyDown(e: KeyboardEvent): void {
        const step = e.shiftKey ? 1 : 0.1;
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(clamp(value + step));
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value - step));
        }
    }

    const n = norm(value);
    const fillColor = (() => {
        if (n > 0.66) {
            return '#C44030';
        }
        if (n > 0.33) {
            return '#D4A847';
        }
        return '#5B8FC4';
    })();

    let valueColor = '#E8E6E0';
    if (value > 12) {
        valueColor = '#C44030';
    } else if (value > 6) {
        valueColor = '#D4A847';
    }

    return (
        <Stack
            align="center"
            gap={1}
            shrink={false}
            className="px-1.5 py-2 select-none"
            style={{
                width: 52,
                background: 'linear-gradient(180deg, #0A0A0C 0%, #0E0E10 100%)',
                borderRight: '1px solid rgba(46,46,54,0.5)',
            }}
        >
            <span className="text-[7px] font-semibold text-muted-foreground/40 uppercase tracking-widest">Gain</span>

            {/* Drag track */}
            <Row
                align="stretch"
                justify="center"
                grow
                className="relative w-full cursor-pointer"
                ref={trackRef}
                style={{ minHeight: 120 }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                role="slider"
                aria-label="Input gain"
                aria-valuemin={MIN}
                aria-valuemax={MAX}
                aria-valuenow={Math.round(value * 10) / 10}
                aria-valuetext={`${value.toFixed(1)} dB`}
                tabIndex={0}
                onKeyDown={handleKeyDown}
            >
                {/* Track rail */}
                <div
                    className="absolute top-0 bottom-0 rounded-full"
                    style={{ width: 4, left: '50%', transform: 'translateX(-50%)', background: '#1E1E22' }}
                />

                {/* Fill */}
                <div
                    className="absolute rounded-full pointer-events-none transition-none"
                    style={{
                        width: 4,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        bottom: 0,
                        height: `${n * 100}%`,
                        background: `linear-gradient(to top, #5B8FC4, ${fillColor})`,
                    }}
                />

                {/* Thumb */}
                <div
                    className="absolute pointer-events-none"
                    style={{
                        width: 28,
                        height: 10,
                        left: '50%',
                        bottom: `${n * 100}%`,
                        transform: 'translate(-50%, 50%)',
                        background: '#E8E6E0',
                        borderRadius: 3,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                    }}
                >
                    {/* Center notch */}
                    <div
                        style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: 8,
                            height: 2,
                            background: '#0E0E10',
                            borderRadius: 1,
                        }}
                    />
                </div>

                {/* 0 dB reference tick */}
                <div
                    className="absolute pointer-events-none"
                    style={{ bottom: 0, left: '50%', transform: 'translate(8px, 0)' }}
                >
                    <span className="text-[6px] font-mono text-muted-foreground/30">0</span>
                </div>
            </Row>

            {/* Numeric readout */}
            <span
                className="text-[9px] font-mono tabular-nums font-semibold"
                style={{ color: valueColor }}
                aria-hidden="true"
            >
                {value > 0 ? '+' : ''}
                {value.toFixed(1)}
            </span>
            <span className="text-[6px] text-muted-foreground/30 font-mono">dB</span>
        </Stack>
    );
};
