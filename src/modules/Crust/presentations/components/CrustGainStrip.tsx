/**
 * CrustGainStrip — the left vertical "push" slider.
 * Pointer-capture based, no drag events — smooth cross-platform.
 * Ctrl/Cmd = fine-mode (0.1× sensitivity).
 */
import { type ReactElement, type KeyboardEvent, useRef, useLayoutEffect, useEffect } from 'react';

import { type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

type Props = {
    value: number; // 0 – 18 dB
    onChange: (v: number, transient?: boolean) => void;
    gestureAuthority?: GestureAuthority;
    onCancel?: () => void;
};

const MIN = 0;
const MAX = 18;

function norm(v: number): number {
    return Math.max(0, Math.min(1, v / MAX));
}
function clamp(v: number): number {
    return Math.max(MIN, Math.min(MAX, v));
}

export const CrustGainStrip = ({ value, onChange, gestureAuthority, onCancel }: Props): ReactElement => {
    const trackRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{
        active: boolean;
        pointerId: number | null;
        startY: number;
        startValue: number;
        latest: number;
        token?: string | number;
        moved: boolean;
    }>({ active: false, pointerId: null, startY: 0, startValue: 0, latest: value, moved: false });
    const callbacks = useRef({ onChange, onCancel, gestureAuthority });
    useLayoutEffect(() => {
        callbacks.current = { onChange, onCancel, gestureAuthority };
        if (!drag.current.active) {
            drag.current.latest = value;
        }
    });

    function clearDrag(): void {
        const pointerId = drag.current.pointerId;
        drag.current.active = false;
        drag.current.pointerId = null;
        if (pointerId !== null) {
            try {
                trackRef.current?.releasePointerCapture(pointerId);
            } catch {
                /* Capture may already be lost. */
            }
        }
    }

    function ownsDrag(): boolean {
        const authority = callbacks.current.gestureAuthority;
        const token = drag.current.token;
        return !authority || (token !== undefined && authority.isCurrent(token));
    }

    function cancelDrag(): void {
        if (!drag.current.active) {
            return;
        }
        clearDrag();
        callbacks.current.onCancel?.();
    }

    function finishDrag(): void {
        if (!drag.current.active) {
            return;
        }
        const { latest, moved } = drag.current;
        const current = ownsDrag();
        clearDrag();
        if (current && moved) {
            callbacks.current.onChange(latest, false);
        }
    }

    useEffect(() => {
        window.addEventListener('blur', cancelDrag);
        return () => {
            window.removeEventListener('blur', cancelDrag);
            cancelDrag();
        };
    }, []);

    function handlePointerDown(e: React.PointerEvent): void {
        if (drag.current.active || e.button !== 0) {
            return;
        }
        const authority = callbacks.current.gestureAuthority;
        const token = authority?.acquire(finishDrag);
        if (authority && (token === undefined || !authority.isCurrent(token))) {
            return;
        }
        drag.current = {
            active: true,
            pointerId: e.pointerId,
            startY: e.clientY,
            startValue: value,
            latest: value,
            token,
            moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: React.PointerEvent): void {
        if (!drag.current.active || drag.current.pointerId !== e.pointerId || !trackRef.current) {
            return;
        }
        if (!ownsDrag()) {
            cancelDrag();
            return;
        }
        const trackH = trackRef.current.getBoundingClientRect().height;
        if (trackH <= 0) {
            return;
        }
        const dy = drag.current.startY - e.clientY;
        const scale = e.ctrlKey || e.metaKey ? 0.1 : 1;
        const next = clamp(drag.current.startValue + (dy / trackH) * MAX * scale);
        if (next === drag.current.latest) {
            return;
        }
        drag.current.latest = next;
        drag.current.moved = true;
        callbacks.current.onChange(next, true);
    }

    function handlePointerUp(e: React.PointerEvent): void {
        if (drag.current.pointerId === e.pointerId) {
            finishDrag();
        }
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if (drag.current.active || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
            return;
        }
        e.preventDefault();
        const authority = callbacks.current.gestureAuthority;
        const token = authority?.acquire(finishDrag);
        if (authority && (token === undefined || !authority.isCurrent(token))) {
            return;
        }
        const step = e.shiftKey ? 1 : 0.1;
        const next = clamp(value + (e.key === 'ArrowUp' ? step : -step));
        if (next !== value) {
            callbacks.current.onChange(next, false);
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
                background: 'linear-gradient(180deg, var(--surface-base) 0%, var(--surface-default) 100%)',
                borderRight: '1px solid var(--color-border-soft)',
            }}
        >
            <span className="text-nano font-semibold text-muted-foreground/40 uppercase tracking-widest">Gain</span>

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
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
                onBlur={cancelDrag}
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
                    className="absolute top-0 bottom-0 rounded-full bg-surface-raised"
                    style={{ width: 4, left: '50%', transform: 'translateX(-50%)' }}
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
                        background: 'var(--color-text-primary)',
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
                            background: 'var(--surface-base)',
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
                className="text-caption font-mono tabular-nums font-semibold"
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
