/**
 * CrustSatCurve — 80×80 px canvas showing the saturation transfer function.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { type CrustSatAlgorithm } from '../../models/CrustPatch';

type Props = {
    algorithm: CrustSatAlgorithm;
    drive: number; // 0–18 dB → controls how far the curve bends
};

function drawCurve(ctx: CanvasRenderingContext2D, algo: CrustSatAlgorithm, drive: number): void {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const P = 8; // padding

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0E0E10';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1E1E22';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(W / 2, P);
    ctx.lineTo(W / 2, H - P);
    ctx.moveTo(P, H / 2);
    ctx.lineTo(W - P, H / 2);
    ctx.stroke();

    // 45° reference (linear = no saturation)
    ctx.strokeStyle = '#2E2E36';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(P, H - P);
    ctx.lineTo(W - P, P);
    ctx.stroke();
    ctx.setLineDash([]);

    // Transfer function
    const t = drive / 18; // 0–1 drive intensity
    const gain = 1 + t * 3; // scales how much distortion

    ctx.strokeStyle = '#D4883A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const steps = 64;
    const usableW = W - P * 2;
    const usableH = H - P * 2;

    for (let i = 0; i <= steps; i++) {
        const xNorm = i / steps; // 0 → 1
        const x = P + xNorm * usableW;
        const inSig = (xNorm - 0.5) * 2 * gain; // -gain → +gain

        let outSig: number;
        switch (algo) {
            case 'hard':
                outSig = Math.max(-1, Math.min(1, inSig));
                break;
            case 'tape':
                outSig = Math.tanh(inSig * 0.8) * 1.1 * (inSig < 0 ? 0.9 : 1.0);
                break;
            case 'tube':
                outSig = inSig > 0 ? Math.tanh(inSig * 1.2) + inSig * 0.05 : Math.tanh(inSig);
                break;
            case 'fold': {
                const s = inSig;
                outSig = (() => {
                    if (s > 1) {
                        return 2 - s;
                    }
                    if (s < -1) {
                        return -2 - s;
                    }
                    return s;
                })();
                outSig = Math.max(-1, Math.min(1, outSig));
                break;
            }
            case 'soft':
                outSig = Math.tanh(inSig);
                break;
        }

        const normalized = outSig / (gain * 1.2);
        const y = P + (1 - (normalized + 1) / 2) * usableH;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
}

export const CrustSatCurve = ({ algorithm, drive }: Props): ReactElement => {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        drawCurve(ctx, algorithm, drive);
    }, [algorithm, drive]);

    return (
        <canvas
            ref={ref}
            width={80}
            height={80}
            style={{ borderRadius: 4, border: '1px solid rgba(46,46,54,0.5)' }}
            aria-label={`Saturation transfer curve: ${algorithm}`}
        />
    );
};
