import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type PadState, type Pattern, type Step } from '../../../models/ToasterKit';
import { StepSequencer } from '../StepSequencer';

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

function makePattern(numPads: number, steps: number): Pattern {
    return {
        id: 'pat1',
        name: 'A',
        stepsPerBar: steps,
        bars: 1,
        tracks: Array.from({ length: numPads }, (_, padIndex) => ({
            padIndex,
            steps: Array.from({ length: steps }, () => ({ ...baseStep })),
        })),
    };
}

describe('StepSequencer', () => {
    it('should render', () => {
        const pads = Array.from({ length: 2 }, (_, index) => makePad(index));
        const pattern = makePattern(2, 4);
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

    it('should expose each step as a checkbox reflecting its active state', () => {
        const pads = [makePad(0)];
        const pattern = makePattern(1, 4);
        const firstTrack = pattern.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a seeded pattern track');
        }
        firstTrack.steps[0] = { ...baseStep, active: true, velocity: 0.5 };

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

        const cells = screen.getAllByRole('checkbox');
        expect(cells).toHaveLength(4);
        expect(cells[0]).toHaveAttribute('aria-checked', 'true');
        expect(cells[0]).toHaveAccessibleName(/p0 step 1, on, velocity 50%/i);
        expect(cells[1]).toHaveAttribute('aria-checked', 'false');
        expect(cells[1]).toHaveAccessibleName(/p0 step 2, off/i);
    });

    it('should toggle a step from the keyboard via Enter and Space', () => {
        const onToggleStep = vi.fn();
        const pads = [makePad(0)];
        const pattern = makePattern(1, 4);

        render(
            <StepSequencer
                pattern={pattern}
                pads={pads}
                currentStep={0}
                isPlaying={false}
                onToggleStep={onToggleStep}
                onSetVelocity={vi.fn()}
            />
        );

        const cells = screen.getAllByRole('checkbox');
        const secondCell = cells[1];
        const thirdCell = cells[2];
        if (!secondCell || !thirdCell) {
            throw new Error('Expected at least three step cells');
        }
        fireEvent.keyDown(thirdCell, { key: 'Enter' });
        expect(onToggleStep).toHaveBeenCalledWith(0, 2);

        onToggleStep.mockClear();
        fireEvent.keyDown(secondCell, { key: ' ' });
        expect(onToggleStep).toHaveBeenCalledWith(0, 1);
    });

    it('should surface the Alt-drag velocity gesture as a discoverable hint and per-cell tooltip', () => {
        const pads = [makePad(0)];
        const pattern = makePattern(1, 4);

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

        expect(screen.getByText(/alt-drag/i)).toBeInTheDocument();
        const cell = screen.getAllByRole('checkbox')[0];
        expect(cell).toHaveAttribute('title', expect.stringMatching(/alt-drag/i));
    });
});
