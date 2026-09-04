/**
 * XY Morph Pad — bilinear interpolation between 4 snapshots (A/B/C/D).
 *
 * Renders a draggable crosshair over a gradient background showing
 * the current morph position.
 */
import { type ReactElement, useRef } from 'react';

import { type BacteriaSnapshot } from '../../models/BacteriaPatch';

type XYMorphPadProps = {
    x: number;
    y: number;
    onChangeX: (value: number) => void;
    onChangeY: (value: number) => void;
    snapshots: BacteriaSnapshot[];
    width: number;
    height: number;
};

export const XYMorphPad = ({ x, y, onChangeX, onChangeY, snapshots, width, height }: XYMorphPadProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);

    const handlePointerDown = (e: React.PointerEvent): void => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        updatePosition(e);
    };

    const handlePointerMove = (e: React.PointerEvent): void => {
        if (!dragging.current) {
            return;
        }
        updatePosition(e);
    };

    const handlePointerUp = (): void => {
        dragging.current = false;
    };

    const handlePointerCancel = (): void => {
        dragging.current = false;
    };

    const updatePosition = (e: React.PointerEvent): void => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
        onChangeX(nx);
        onChangeY(ny);
    };

    const labels = ['A', 'B', 'C', 'D'];

    return (
        <div
            ref={containerRef}
            className="relative rounded-lg border border-border/30 cursor-crosshair select-none overflow-hidden"
            style={{
                width,
                height,
                background: 'radial-gradient(ellipse at center, rgba(244,63,94,0.08) 0%, rgba(0,0,0,0.95) 100%)',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
        >
            {/* Grid lines */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                    backgroundSize: `${width / 4}px ${height / 4}px`,
                }}
            />

            {/* Corner labels */}
            {snapshots.slice(0, 4).map((snap, i) => {
                const corners = [
                    { left: 4, bottom: 4 },
                    { right: 4, bottom: 4 },
                    { left: 4, top: 4 },
                    { right: 4, top: 4 },
                ];
                return (
                    <span
                        key={snap.id}
                        className="absolute text-micro font-bold text-rose-400/40 pointer-events-none"
                        style={corners[i]}
                    >
                        {labels[i]}
                    </span>
                );
            })}

            {/* Crosshair */}
            <div
                className="absolute w-3 h-3 rounded-full border-2 border-rose-400 pointer-events-none"
                style={{
                    left: x * width - 6,
                    top: (1 - y) * height - 6,
                    boxShadow: '0 0 8px rgba(244,63,94,0.4), inset 0 0 4px rgba(244,63,94,0.2)',
                }}
            />
            {/* Crosshair lines */}
            <div
                className="absolute pointer-events-none"
                style={{ left: x * width, top: 0, width: 1, height, background: 'rgba(244,63,94,0.15)' }}
            />
            <div
                className="absolute pointer-events-none"
                style={{ top: (1 - y) * height, left: 0, width, height: 1, background: 'rgba(244,63,94,0.15)' }}
            />
        </div>
    );
};
