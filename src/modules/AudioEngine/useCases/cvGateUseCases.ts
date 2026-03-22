/**
 * CV/Gate Output
 *
 * Modular synth control via DC-coupled audio interfaces.
 * Generates control voltage and gate signals for hardware synth control.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type VoltageStandard = '1v-per-octave' | 'hz-per-volt';

export type CvOutputChannel = {
    id: string;
    name: string;
    /** Audio output channel index (DC-coupled interface required) */
    outputChannel: number;
    /** Signal type */
    type: 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';
    /** Voltage range */
    minVoltage: number;
    maxVoltage: number;
    /** Current value (normalized 0-1) */
    value: number;
    /** Is this output active? */
    active: boolean;
};

export type CvGateState = {
    outputs: CvOutputChannel[];
    /** V/Oct or Hz/V standard */
    voltageStandard: VoltageStandard;
    /** Clock division for clock output */
    clockDivision: number;
    /** Trigger pulse width in ms */
    triggerPulseMs: number;
    /** Gate threshold velocity (0-127) */
    gateThreshold: number;
};

export const cvGateStore = new Store<CvGateState>(logger, {
    initialData: {
        outputs: [],
        voltageStandard: '1v-per-octave',
        clockDivision: 1,
        triggerPulseMs: 5,
        gateThreshold: 1,
    },
});

let outputId = 1;

export function addCvOutput(
    name: string,
    outputChannel: number,
    type: CvOutputChannel['type']
): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }

    const voltageRanges: Record<CvOutputChannel['type'], [number, number]> = {
        'cv-pitch': [-2, 8],     // -2V to +8V (10 octaves)
        'cv-velocity': [0, 5],   // 0-5V
        'cv-modulation': [0, 5], // 0-5V
        'gate': [0, 5],          // 0V or 5V
        'trigger': [0, 5],       // Short pulse at 5V
        'clock': [0, 5],         // Square wave
    };

    const [minV, maxV] = voltageRanges[type];

    const output: CvOutputChannel = {
        id: `cv-${outputId++}`, name, outputChannel, type,
        minVoltage: minV, maxVoltage: maxV, value: 0, active: true,
    };

    cvGateStore.set({ ...state, outputs: [...state.outputs, output] });
}

export function removeCvOutput(id: string): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, outputs: state.outputs.filter((o) => o.id !== id) });
}

/**
 * Convert a MIDI note number to CV voltage (1V/oct standard).
 * C0 = 0V, C1 = 1V, etc.
 */
export function midiNoteToCv(note: number): number {
    const state = cvGateStore.value;
    if (!state) {
        return 0;
    }
    if (state.voltageStandard === '1v-per-octave') {
        return (note - 24) / 12; // C0 (MIDI 24) = 0V
    }
    // Hz/V: frequency doubles per octave
    return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Convert velocity to CV voltage.
 */
export function velocityToCv(velocity: number, maxVoltage: number = 5): number {
    return (velocity / 127) * maxVoltage;
}

/**
 * Generate a clock signal value at the given tempo and time.
 */
export function getClockValue(bpm: number, timeSec: number, division: number = 1): number {
    const pulsePerSec = (bpm / 60) * division;
    const phase = (timeSec * pulsePerSec) % 1;
    return phase < 0.5 ? 1 : 0; // Square wave
}

export function setVoltageStandard(standard: VoltageStandard): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, voltageStandard: standard });
}

export function setClockDivision(division: number): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, clockDivision: division });
}

export function setCvValue(outputIdVal: string, value: number): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({
        ...state,
        outputs: state.outputs.map((o) =>
            o.id === outputIdVal ? { ...o, value: Math.max(0, Math.min(1, value)) } : o
        ),
    });
}
