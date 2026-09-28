/**
 * LUFS Meter component.
 * Displays momentary, short-term, and integrated loudness on a Canvas2D bar.
 */
import { type ReactElement, useRef, useEffect, useState } from 'react';

import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Stack } from '#/components/layout';
import {
    getAudioSampleRate,
    getMasterStereoAnalysers,
    MomentaryLUFS,
    ShortTermLUFS,
    IntegratedLUFS,
} from '#/modules/AudioEngine/useCases';
import { METER_FLOOR_DB, R128_TARGET_LUFS } from '#/utils/audioLevelLaw';
import { resolveToken } from '#/utils/UI/resolveToken';

type LUFSMeterProps = {
    height?: number;
    width?: number;
    target?: number;
};

/** BS.1770-4 momentary block: 400 ms of programme, the granularity the meters change at. */
const MOMENTARY_BLOCK_SECONDS = 0.4;

export const LUFSMeter = ({ height = 160, width = 48, target = R128_TARGET_LUFS }: LUFSMeterProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const momentaryRef = useRef<MomentaryLUFS | null>(null);
    const shortTermRef = useRef(new ShortTermLUFS());
    const integratedRef = useRef(new IntegratedLUFS());
    const [momentary, setMomentary] = useState(-70);
    const [shortTerm, setShortTerm] = useState(-70);
    const [integrated, setIntegrated] = useState(-70);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        // HiDPI scaling
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Resolve theme tokens once, outside the animation loop
        const paletteSky = resolveToken('--color-palette-sky', '#5a80a8');
        const meterClip = resolveToken('--color-meter-clip', '#FF3300');
        const meterHot = resolveToken('--color-meter-hot', '#CCCC00');
        const meterSafe = resolveToken('--color-meter-safe', '#00CC44');

        let rafId = 0;
        let lastStateUpdate = 0;
        const STATE_UPDATE_INTERVAL = 100; // ~10fps for React state
        // The momentary meter persists across redraws: its 400 ms window and
        // K-weighting state span frames, sized once from the engine's rate.
        let momentary = momentaryRef.current;
        if (!momentary) {
            momentary = new MomentaryLUFS(getAudioSampleRate());
            momentaryRef.current = momentary;
        }
        // Reused across frames — reallocated only if the analyser grows.
        let tapData: {
            left: Float32Array<ArrayBuffer>;
            right: Float32Array<ArrayBuffer>;
        } | null = null;

        // The tap offers only its newest fftSize samples per frame while the
        // audio clock moves further between frames, so pushing per frame
        // would feed the meters a fraction of the programme and stretch the
        // 400 ms momentary window over seconds of wall time. Reads accumulate
        // here and whole 400 ms blocks are handed to the meter instead.
        const blockFrames = Math.round(MOMENTARY_BLOCK_SECONDS * getAudioSampleRate());
        let pendingLeft = new Float32Array(0);
        let pendingRight = new Float32Array(0);
        let pendingFrames = 0;

        /** Append one tap read; push a block once 400 ms of programme is held. */
        const pushAccumulatedBlock = (left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>): boolean => {
            const frameCount = Math.min(left.length, right.length);
            const needed = pendingFrames + frameCount;
            if (needed > pendingLeft.length) {
                // Mirrors the tap buffers: reallocated only if the analyser grows.
                const grownLeft = new Float32Array(needed);
                grownLeft.set(pendingLeft);
                pendingLeft = grownLeft;
                const grownRight = new Float32Array(needed);
                grownRight.set(pendingRight);
                pendingRight = grownRight;
            }
            pendingLeft.set(left.subarray(0, frameCount), pendingFrames);
            pendingRight.set(right.subarray(0, frameCount), pendingFrames);
            pendingFrames += frameCount;
            if (pendingFrames < blockFrames) {
                return false;
            }
            // A read never carries a whole block — fftSize stays far below
            // 400 ms of samples — so exactly one block can be pending here.
            momentary.push(pendingLeft.subarray(0, blockFrames), pendingRight.subarray(0, blockFrames));
            pendingLeft.copyWithin(0, blockFrames, pendingFrames);
            pendingRight.copyWithin(0, blockFrames, pendingFrames);
            pendingFrames -= blockFrames;
            return true;
        };

        const draw = (): void => {
            const { left: leftAnalyser, right: rightAnalyser } = getMasterStereoAnalysers();
            if (!tapData || tapData.left.length !== leftAnalyser.fftSize) {
                tapData = {
                    left: new Float32Array(leftAnalyser.fftSize),
                    right: new Float32Array(rightAnalyser.fftSize),
                };
            }
            const { left: leftData, right: rightData } = tapData;
            // fftSize, not frequencyBinCount: getFloatTimeDomainData fills up to
            // fftSize samples, so the frequency-bin length would read half the tap.
            leftAnalyser.getFloatTimeDomainData(leftData);
            rightAnalyser.getFloatTimeDomainData(rightData);

            const released = pushAccumulatedBlock(leftData, rightData);
            const mom = momentary.value;
            // The short-term and integrated windows join per whole 400 ms
            // block; a frame that releases none must not re-push the window's
            // previous block.
            if (released) {
                shortTermRef.current.push(momentary.energy);
                integratedRef.current.push(mom);
            }

            const st = shortTermRef.current.value;
            const integ = integratedRef.current.value;

            // Throttle React state updates to ~10fps (only for text/aria readout)
            const now = performance.now();
            if (now - lastStateUpdate > STATE_UPDATE_INTERVAL) {
                setMomentary(mom);
                setShortTerm(st);
                setIntegrated(integ);
                lastStateUpdate = now;
            }

            // Draw
            ctx.clearRect(0, 0, width, height);

            const minLUFS = METER_FLOOR_DB;
            const maxLUFS = 0;
            const range = maxLUFS - minLUFS;
            const lufsToY = (lufs: number): number =>
                height - ((Math.max(minLUFS, Math.min(maxLUFS, lufs)) - minLUFS) / range) * height;

            // Background — deep black
            ctx.fillStyle = '#050508';
            ctx.fillRect(0, 0, width, height);

            // Scale marks — subtle dashed lines, dim labels
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 4]);
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.font = '8px monospace';
            ctx.textAlign = 'right';
            for (let db = 0; db >= minLUFS; db -= 6) {
                const y = lufsToY(db);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillText(`${db}`, width - 2, y - 2);
            }
            ctx.setLineDash([]);

            // Target line — with subtle glow
            const targetY = lufsToY(target);
            ctx.strokeStyle = paletteSky;
            ctx.lineWidth = 1;
            ctx.shadowColor = paletteSky;
            ctx.shadowBlur = 4;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, targetY);
            ctx.lineTo(width, targetY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;

            // Momentary bar
            const barW = 10;
            const momY = lufsToY(mom);
            ctx.fillStyle = (() => {
                if (mom > -3) {
                    return meterClip;
                }
                if (mom > target) {
                    return meterHot;
                }
                return meterSafe;
            })();
            ctx.fillRect(2, momY, barW, height - momY);

            // Short-term bar
            const stY = lufsToY(st);
            ctx.fillStyle = (() => {
                if (st > -3) {
                    return `${meterClip}99`;
                }
                if (st > target) {
                    return `${meterHot}99`;
                }
                return `${meterSafe}99`;
            })();
            ctx.fillRect(14, stY, barW, height - stY);

            // Integrated bar
            const integY = lufsToY(integ);
            ctx.fillStyle = paletteSky;
            ctx.fillRect(26, integY, barW, height - integY);

            // Segmented LED look on all bars
            ctx.fillStyle = '#050508';
            for (let sy = 0; sy < height; sy += 4) {
                ctx.fillRect(2, sy, barW, 1);
                ctx.fillRect(14, sy, barW, 1);
                ctx.fillRect(26, sy, barW, 1);
            }

            // Labels — dim and refined
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '7px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('M', 7, height - 2);
            ctx.fillText('S', 19, height - 2);
            ctx.fillText('I', 31, height - 2);

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [height, width, target]);

    return (
        <Stack align="center" gap={1}>
            <DawMeterFrame overlay="vertical">
                <canvas
                    ref={canvasRef}
                    width={width}
                    height={height}
                    className="block"
                    aria-label={`LUFS: Momentary ${momentary > -70 ? momentary.toFixed(1) : '-∞'}, Short-term ${shortTerm > -70 ? shortTerm.toFixed(1) : '-∞'}, Integrated ${integrated > -70 ? integrated.toFixed(1) : '-∞'}`}
                />
            </DawMeterFrame>
            <DawReadoutRow
                className="w-full gap-1"
                label="I"
                labelClassName="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70"
                value={`${integrated > -70 ? integrated.toFixed(1) : '-∞'} LUFS`}
            />
        </Stack>
    );
};
