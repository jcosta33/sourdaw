/**
 * Groove templates — timing offset arrays that define the feel of classic drum machines.
 * Each template is 16 values of micro-timing offsets in steps (-0.5 to +0.5).
 * Positive = late, negative = early.
 */

export type GrooveTemplate = {
    name: string;
    offsets: number[];  // 16 values, one per step
};

export const GROOVE_TEMPLATES: GrooveTemplate[] = [
    {
        name: 'Straight',
        offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        // MPC 50% swing — every other step pushed late
        name: 'MPC Swing 50',
        offsets: [0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08],
    },
    {
        // MPC 66% — triplet feel
        name: 'MPC Swing 66',
        offsets: [0, 0.16, 0, 0.16, 0, 0.16, 0, 0.16, 0, 0.16, 0, 0.16, 0, 0.16, 0, 0.16],
    },
    {
        // SP-1200 timing (slightly uneven quantization from the Z80 processor)
        name: 'SP-1200',
        offsets: [0, 0.12, 0.02, 0.10, 0, 0.11, 0.01, 0.12, 0, 0.12, 0.02, 0.10, 0, 0.11, 0.01, 0.12],
    },
    {
        // TR-808 shuffle
        name: '808 Shuffle',
        offsets: [0, 0.06, 0, 0.06, 0, 0.06, 0, 0.06, 0, 0.06, 0, 0.06, 0, 0.06, 0, 0.06],
    },
    {
        // Lazy/laid-back feel — snare and hats slightly late
        name: 'Laid Back',
        offsets: [0, 0.03, 0.02, 0.04, 0, 0.03, 0.02, 0.04, 0, 0.03, 0.02, 0.04, 0, 0.03, 0.02, 0.04],
    },
    {
        // Pushed/ahead feel — everything slightly early
        name: 'Pushed',
        offsets: [0, -0.02, -0.01, -0.03, 0, -0.02, -0.01, -0.03, 0, -0.02, -0.01, -0.03, 0, -0.02, -0.01, -0.03],
    },
    {
        // Broken/human feel — slight random-feeling asymmetry
        name: 'Human',
        offsets: [0, 0.04, -0.01, 0.06, 0.01, 0.03, -0.02, 0.05, 0, 0.04, -0.01, 0.06, 0.01, 0.03, -0.02, 0.05],
    },
];
