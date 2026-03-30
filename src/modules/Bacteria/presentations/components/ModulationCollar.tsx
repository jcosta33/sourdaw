/**
 * ModulationCollar — animated arc around a knob showing modulation depth/range.
 *
 * Vital-style modulation visualization that wraps around RotaryKnob components.
 */
import { type ReactElement } from 'react';

type ModulationCollarProps = {
    /** Current parameter value normalized to 0-1 */
    value: number;
    /** Modulation depth (-1 to 1) */
    modAmount: number;
    /** Current real-time modulation offset (-1 to 1) */
    modValue: number;
    /** Size matches the knob */
    size: number;
    /** Accent color for the collar */
    color?: string;
};

export const ModulationCollar = ({
    value,
    modAmount,
    modValue,
    size,
    color = 'rgb(244, 63, 94)',
}: ModulationCollarProps): ReactElement => {
    if (Math.abs(modAmount) < 0.001) {
        return <></>;
    }

    const radius = size / 2 + 2;
    const center = size / 2 + 4;
    const svgSize = size + 8;

    // Knob range: typically 135° to 405° (270° sweep, starting from bottom-left)
    const startAngle = 135;
    const sweepAngle = 270;

    const modMin = Math.max(0, Math.min(1, value + modAmount * modValue - Math.abs(modAmount) * 0.5));
    const modMax = Math.max(0, Math.min(1, value + modAmount * modValue + Math.abs(modAmount) * 0.5));
    const modMinAngle = startAngle + modMin * sweepAngle;
    const modMaxAngle = startAngle + modMax * sweepAngle;

    const toRad = (deg: number): number => (deg * Math.PI) / 180;

    const arcPath = (startDeg: number, endDeg: number, r: number): string => {
        const start = toRad(startDeg);
        const end = toRad(endDeg);
        const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
        const x1 = center + r * Math.cos(start);
        const y1 = center + r * Math.sin(start);
        const x2 = center + r * Math.cos(end);
        const y2 = center + r * Math.sin(end);
        return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    };

    return (
        <svg
            width={svgSize}
            height={svgSize}
            className="absolute top-[-4px] left-[-4px] pointer-events-none"
            style={{ overflow: 'visible' }}
        >
            {/* Modulation range arc */}
            <path
                d={arcPath(modMinAngle, modMaxAngle, radius)}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                opacity={0.4}
            />
            {/* Current modulated position dot */}
            {(() => {
                const modPos = Math.max(0, Math.min(1, value + modAmount * modValue));
                const angle = toRad(startAngle + modPos * sweepAngle);
                const dotX = center + radius * Math.cos(angle);
                const dotY = center + radius * Math.sin(angle);
                return <circle cx={dotX} cy={dotY} r={2} fill={color} opacity={0.8} />;
            })()}
        </svg>
    );
};
