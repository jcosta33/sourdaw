import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Row, Stack } from '#/components/layout';

import { type FermenterPatch, DEFAULT_PATCH } from '../../models/FermenterPatch';
import { FERMENTER_PRESETS } from '../../useCases/fermenterQueries/helpers';
import { applyMorphedPatch } from '../../useCases/presetMorph/applyMorphedPatch';
import { bilinearPatch } from '../../useCases/presetMorph/bilinearPatch';

type TransformPadProps = { deviceId: string };

const PAD_SIZE = 160;
const CORNER_PRESETS = ['fermenter-init', 'fermenter-supersaw', 'fermenter-dark-drone', 'fermenter-acid-bass'];

function presetToPatch(presetId: string): FermenterPatch {
    const preset = FERMENTER_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
        return { ...DEFAULT_PATCH };
    }

    const values = preset.devices[0]?.parameterValues;
    if (!values) {
        return { ...DEFAULT_PATCH };
    }

    const patch: FermenterPatch = { ...DEFAULT_PATCH, name: preset.name, macros: [...DEFAULT_PATCH.macros] };
    for (const [key, value] of Object.entries(values)) {
        if (key in patch && typeof value === 'number') {
            (patch as Record<string, unknown>)[key] = value;
        } else if (key.startsWith('macro') && typeof value === 'number') {
            const idx = parseInt(key.slice(5), 10);
            if (idx >= 0 && idx < 8) {
                patch.macros[idx] = value;
            }
        }
    }

    return patch;
}

export const TransformPad = ({ deviceId }: TransformPadProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [puck, setPuck] = useState({ x: 0.5, y: 0.5 });
    const [dragging, setDragging] = useState(false);
    const [corners] = useState(() => CORNER_PRESETS.map(presetToPatch));

    function applyPosition(x: number, y: number): void {
        const morphed = bilinearPatch(corners[0]!, corners[1]!, corners[2]!, corners[3]!, x, y);
        morphed.name = 'Transform';
        applyMorphedPatch(deviceId, morphed);
    }

    function updateFromPointer(event: React.PointerEvent<HTMLCanvasElement>): void {
        const rect = event.currentTarget.getBoundingClientRect();
        const nextX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const nextY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

        setPuck({ x: nextX, y: nextY });
        applyPosition(nextX, nextY);
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
        canvas.width = PAD_SIZE * dpr;
        canvas.height = PAD_SIZE * dpr;

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(dpr, dpr);
        context.clearRect(0, 0, PAD_SIZE, PAD_SIZE);

        const gradient = context.createLinearGradient(0, 0, PAD_SIZE, PAD_SIZE);
        gradient.addColorStop(0, 'rgba(127,184,196,0.12)');
        gradient.addColorStop(0.5, 'rgba(18,18,24,0.92)');
        gradient.addColorStop(1, 'rgba(168,155,196,0.12)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, PAD_SIZE, PAD_SIZE);

        context.strokeStyle = 'rgba(255,255,255,0.05)';
        context.lineWidth = 1;
        for (let index = 1; index < 4; index += 1) {
            const offset = (index / 4) * PAD_SIZE;
            context.beginPath();
            context.moveTo(offset, 0);
            context.lineTo(offset, PAD_SIZE);
            context.moveTo(0, offset);
            context.lineTo(PAD_SIZE, offset);
            context.stroke();
        }

        context.font = '8px system-ui';
        context.fillStyle = 'rgba(255,255,255,0.28)';
        const labels = corners.map((patch) => patch.name.replace('Fermenter — ', '').slice(0, 8));
        context.textAlign = 'left';
        context.fillText(labels[0] ?? '', 6, 13);
        context.textAlign = 'right';
        context.fillText(labels[1] ?? '', PAD_SIZE - 6, 13);
        context.textAlign = 'left';
        context.fillText(labels[2] ?? '', 6, PAD_SIZE - 6);
        context.textAlign = 'right';
        context.fillText(labels[3] ?? '', PAD_SIZE - 6, PAD_SIZE - 6);

        const puckX = puck.x * PAD_SIZE;
        const puckY = puck.y * PAD_SIZE;

        const glow = context.createRadialGradient(puckX, puckY, 0, puckX, puckY, 20);
        glow.addColorStop(0, 'rgba(127,184,196,0.36)');
        glow.addColorStop(1, 'rgba(127,184,196,0)');
        context.fillStyle = glow;
        context.fillRect(puckX - 20, puckY - 20, 40, 40);

        context.fillStyle = '#7fb8c4';
        context.beginPath();
        context.arc(puckX, puckY, 5, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(255,255,255,0.45)';
        context.lineWidth = 1;
        context.stroke();
    }, [corners, puck]);

    return (
        <Stack gap={1.5}>
            <Row justify="between" className="px-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Scene morph
                </div>
                <div className="text-[8px] text-muted-foreground/55">Four corners</div>
            </Row>
            <canvas
                ref={canvasRef}
                className="rounded-[16px] border border-white/8"
                style={{
                    width: PAD_SIZE,
                    height: PAD_SIZE,
                    cursor: dragging ? 'grabbing' : 'grab',
                    touchAction: 'none',
                }}
                onPointerDown={(event) => {
                    setDragging(true);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateFromPointer(event);
                }}
                onPointerMove={(event) => {
                    if (dragging) {
                        updateFromPointer(event);
                    }
                }}
                onPointerUp={() => {
                    setDragging(false);
                }}
                onPointerCancel={() => {
                    setDragging(false);
                }}
            />
        </Stack>
    );
};
