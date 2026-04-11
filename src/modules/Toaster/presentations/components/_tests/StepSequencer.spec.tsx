import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepSequencer } from '../StepSequencer';
import { type PadState, type Pattern, type Step } from '../../../models/ToasterKit';

function makePad(index: number): PadState {
    return {
        id: index,
        name: `P${index}`,
        color: '#e06060',
        engineType: 'kick-808',
        chokeGroup: 0,
        midiNote: 36 + index,
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        tune: 0,
        decay: 0.5,
        tone: 0.5,
        drive: 0,
        filterCutoff: 20000,
        filterResonance: 1,
        sendReverb: 0,
        sendDelay: 0,
        engineParams: {},
    };
}

const baseStep: Step = {
    active: false,
    velocity: 0.8,
    probability: 1,
    microTiming: 0,
    retriggerCount: 0,
    condition: 'always',
    paramLocks: {},
};

describe('StepSequencer', () => {
    it('should render', () => {
        const pads = Array.from({ length: 2 }, (_, i) => makePad(i));
        const pattern: Pattern = {
            id: 'pat1',
            name: 'A',
            stepsPerBar: 4,
            bars: 1,
            tracks: pads.map((_, padIndex) => ({
                padIndex,
                steps: Array.from({ length: 4 }, () => ({ ...baseStep })),
            })),
        };
        render(
            <StepSequencer
                pattern={pattern}
                pads={pads}
                currentStep={0}
                isPlaying={false}
                onToggleStep={vi.fn()}
                onSetVelocity={vi.fn()}
            />
        );
        expect(screen.getByText('P0')).toBeInTheDocument();
    });
});
