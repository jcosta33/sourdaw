import { type GrooveTemplate } from './types';

function fill(length: number, value: number): number[] {
    return Array.from({ length }, () => value);
}

const STRAIGHT_16: GrooveTemplate = {
    id: 'straight',
    name: 'Straight',
    subdivisions: 16,
    offsets: fill(16, 0),
    velocities: fill(16, 1),
};

const LIGHT_SWING: GrooveTemplate = {
    id: 'swing-light',
    name: 'Light Swing',
    subdivisions: 16,
    offsets: [0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03, 0, 0.03],
    velocities: [1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7, 1, 0.7, 0.9, 0.7],
};

const HEAVY_SWING: GrooveTemplate = {
    id: 'swing-heavy',
    name: 'Heavy Swing',
    subdivisions: 16,
    offsets: [0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08, 0, 0.08],
    velocities: [1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6, 1, 0.6, 0.85, 0.6],
};

const MPC_60: GrooveTemplate = {
    id: 'mpc-60',
    name: 'MPC 60 Feel',
    subdivisions: 16,
    offsets: [0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03, 0, 0.04, 0, 0.02, 0, 0.04, 0, 0.03],
    velocities: [1.15, 0.75, 0.9, 0.7, 1.1, 0.75, 0.85, 0.7, 1.15, 0.75, 0.9, 0.7, 1.1, 0.75, 0.85, 0.7],
};

const SP_1200: GrooveTemplate = {
    id: 'sp-1200',
    name: 'SP-1200 Feel',
    subdivisions: 16,
    offsets: [0, -0.03, 0, -0.01, 0, -0.03, 0, -0.02, 0, -0.03, 0, -0.01, 0, -0.03, 0, -0.02],
    velocities: [1.1, 0.8, 0.95, 0.8, 1.05, 0.8, 0.9, 0.8, 1.1, 0.8, 0.95, 0.8, 1.05, 0.8, 0.9, 0.8],
};

const LIVE_DRUMMER: GrooveTemplate = {
    id: 'live-drummer',
    name: 'Live Drummer',
    subdivisions: 16,
    offsets: [
        0.01, -0.02, 0.015, -0.01, 0.02, -0.015, 0.005, -0.02, 0.015, -0.01, 0.02, -0.005, 0.01, -0.02, 0.015, -0.01,
    ],
    velocities: [1.05, 0.85, 0.95, 0.82, 1.08, 0.83, 0.92, 0.8, 1.06, 0.84, 0.93, 0.81, 1.07, 0.82, 0.94, 0.83],
};

export const FACTORY_GROOVES: GrooveTemplate[] = [STRAIGHT_16, LIGHT_SWING, HEAVY_SWING, MPC_60, SP_1200, LIVE_DRUMMER];

export function getGrooveById(grooveId: string): GrooveTemplate | undefined {
    return FACTORY_GROOVES.find((g) => g.id === grooveId);
}
