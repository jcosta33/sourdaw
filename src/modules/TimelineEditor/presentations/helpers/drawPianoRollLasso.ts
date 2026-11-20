import { type PianoRollLassoPath } from './pianoRollConstants';

export function drawPianoRollLasso(ctx: CanvasRenderingContext2D, path: PianoRollLassoPath | null): void {
    if (!path || path.length < 2) {
        return;
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(128, 104, 152, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    let isFirstPoint = true;
    for (const point of path) {
        if (isFirstPoint) {
            ctx.moveTo(point.x, point.y);
            isFirstPoint = false;
        } else {
            ctx.lineTo(point.x, point.y);
        }
    }
    ctx.stroke();
    ctx.restore();
}
