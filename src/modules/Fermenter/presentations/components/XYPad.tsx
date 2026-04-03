import { type ReactElement, useEffect, useRef } from 'react';

type XYPadProps = {
    xValue: number;
    yValue: number;
    xLabel?: string;
    yLabel?: string;
    onXChange: (value: number) => void;
    onYChange: (value: number) => void;
    size?: number;
};

export const XYPad = ({
    xValue,
    yValue,
    xLabel = 'X',
    yLabel = 'Y',
    onXChange,
    onYChange,
    size = 120,
}: XYPadProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const draggingRef = useRef(false);

    function updateFromPointer(event: React.PointerEvent<HTMLCanvasElement>): void {
        const rect = event.currentTarget.getBoundingClientRect();
        const nextX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const nextY = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));

        onXChange(nextX);
        onYChange(nextY);
    }

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(dpr, dpr);
        context.clearRect(0, 0, size, size);

        const background = context.createLinearGradient(0, 0, size, size);
        background.addColorStop(0, 'rgba(127,184,196,0.12)');
        background.addColorStop(0.5, 'rgba(10,10,14,0.94)');
        background.addColorStop(1, 'rgba(196,170,95,0.12)');
        context.fillStyle = background;
        context.fillRect(0, 0, size, size);

        context.strokeStyle = 'rgba(255,255,255,0.05)';
        context.lineWidth = 1;
        for (let index = 1; index < 4; index += 1) {
            const offset = (index / 4) * size;
            context.beginPath();
            context.moveTo(offset, 0);
            context.lineTo(offset, size);
            context.moveTo(0, offset);
            context.lineTo(size, offset);
            context.stroke();
        }

        const puckX = xValue * size;
        const puckY = (1 - yValue) * size;

        context.strokeStyle = 'rgba(127,184,196,0.2)';
        context.beginPath();
        context.moveTo(puckX, 0);
        context.lineTo(puckX, size);
        context.moveTo(0, puckY);
        context.lineTo(size, puckY);
        context.stroke();

        const glow = context.createRadialGradient(puckX, puckY, 0, puckX, puckY, 18);
        glow.addColorStop(0, 'rgba(127,184,196,0.35)');
        glow.addColorStop(1, 'rgba(127,184,196,0)');
        context.fillStyle = glow;
        context.fillRect(puckX - 18, puckY - 18, 36, 36);

        context.fillStyle = '#7fb8c4';
        context.beginPath();
        context.arc(puckX, puckY, 4.5, 0, Math.PI * 2);
        context.fill();

        context.font = '8px system-ui';
        context.fillStyle = 'rgba(255,255,255,0.25)';
        context.textAlign = 'center';
        context.fillText(xLabel, size / 2, size - 4);

        context.save();
        context.translate(10, size / 2);
        context.rotate(-Math.PI / 2);
        context.fillText(yLabel, 0, 0);
        context.restore();
    }, [size, xLabel, xValue, yLabel, yValue]);

    return (
        <canvas
            ref={canvasRef}
            className="rounded-[16px] border border-white/8"
            style={{
                width: size,
                height: size,
                cursor: draggingRef.current ? 'grabbing' : 'grab',
                touchAction: 'none',
            }}
            onPointerDown={(event) => {
                draggingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateFromPointer(event);
            }}
            onPointerMove={(event) => {
                if (draggingRef.current) {
                    updateFromPointer(event);
                }
            }}
            onPointerUp={() => {
                draggingRef.current = false;
            }}
            onPointerCancel={() => {
                draggingRef.current = false;
            }}
        />
    );
};
