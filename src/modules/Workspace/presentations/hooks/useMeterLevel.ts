import { useState, useEffect, useRef } from "react";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";

type MeterLevel = {
    peak: number;
    rms: number;
    peakHold: number;
};

const RMS_BUFFER_SIZE = 30;
const PEAK_HOLD_DURATION_MS = 1500;
const PEAK_HOLD_FALL_RATE = 0.02;

export const useMeterLevel = (trackId: string | null): MeterLevel => {
    const [level, setLevel] = useState<MeterLevel>({ peak: 0, rms: 0, peakHold: 0 });
    const rafRef = useRef(0);
    const rmsBufferRef = useRef<number[]>([]);
    const peakHoldRef = useRef(0);
    const peakHoldTimeRef = useRef(0);

    useEffect(() => {
        rmsBufferRef.current = [];
        peakHoldRef.current = 0;
        peakHoldTimeRef.current = 0;

        const tick = () => {
            const now = performance.now();
            const peak = trackId
                ? audioEngine.getTrackPeakLevel(trackId)
                : audioEngine.getMasterPeakLevel();

            const buf = rmsBufferRef.current;
            buf.push(peak * peak);
            if (buf.length > RMS_BUFFER_SIZE) buf.shift();

            let sumSquares = 0;
            for (let i = 0; i < buf.length; i++) sumSquares += buf[i]!;
            const rms = Math.sqrt(sumSquares / buf.length);

            if (peak >= peakHoldRef.current) {
                peakHoldRef.current = peak;
                peakHoldTimeRef.current = now;
            } else if (now - peakHoldTimeRef.current > PEAK_HOLD_DURATION_MS) {
                peakHoldRef.current = Math.max(0, peakHoldRef.current - PEAK_HOLD_FALL_RATE);
            }

            setLevel({ peak, rms, peakHold: peakHoldRef.current });
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [trackId]);

    return level;
};
