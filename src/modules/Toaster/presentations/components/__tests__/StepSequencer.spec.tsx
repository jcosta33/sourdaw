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

function renderSeq(
    overrides: {
        pattern?: Pattern;
        isPlaying?: boolean;
        currentStep?: number;
        onToggleStep?: (p: number, s: number) => void;
        onSetVelocity?: (p: number, s: number, v: number) => void;
    } = {}
) {
    const pads = Array.from({ length: 2 }, (_, index) => makePad(index));
    const pattern = overrides.pattern ?? makePattern(2, 4);
    render(
        <StepSequencer
            pattern={pattern}
            pads={pads}
            currentStep={overrides.currentStep ?? 0}
            isPlaying={overrides.isPlaying ?? false}
            onToggleStep={overrides.onToggleStep ?? (() => undefined)}
            onSetVelocity={overrides.onSetVelocity ?? (() => undefined)}
        />
    );
}

describe('StepSequencer', () => {
    it('should render', () => {
        renderSeq();
        expect(screen.getByText('P0')).toBeTruthy();
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
        fireEvent.keyDown(cells[2]!, { key: 'Enter' });
        expect(onToggleStep).toHaveBeenCalledWith(0, 2);

        onToggleStep.mockClear();
        fireEvent.keyDown(cells[1]!, { key: ' ' });
        expect(onToggleStep).toHaveBeenCalledWith(0, 1);
    });

    it('should surface the Alt-drag velocity gesture as a discoverable hint and per-cell tooltip', () => {
        renderSeq();
        expect(screen.getByText(/alt-drag/i)).toBeTruthy();
        const cell = screen.getAllByRole('checkbox')[0];
        expect(cell?.getAttribute('title')).toMatch(/alt-drag/i);
    });
});

describe('StepSequencer — velocity aria-label', () => {
    it('includes velocity percentage in aria-label when step is active', () => {
        const pads = [makePad(0)];
        const pattern = makePattern(1, 2);
        pattern.tracks[0]!.steps[0] = { ...baseStep, active: true, velocity: 0.75 };

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
        expect(cells[0]).toHaveAccessibleName(/velocity 75%/i);
    });
});

describe('StepSequencer — pointer interaction', () => {
    it('fires onToggleStep when a step cell is clicked (no alt)', () => {
        const onToggleStep = vi.fn();
        const pads = [makePad(0)];
        const pattern = makePattern(1, 2);
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
        const cell = screen.getAllByRole('checkbox')[0]!;
        fireEvent.pointerDown(cell, { clientY: 50, pointerId: 1, altKey: false });
        expect(onToggleStep).toHaveBeenCalledWith(0, 0);
    });

    it('fires onSetVelocity on alt-drag pointer move', () => {
        const onSetVelocity = vi.fn();
        const pads = [makePad(0)];
        const pattern = makePattern(1, 2);
        render(
            <StepSequencer
                pattern={pattern}
                pads={pads}
                currentStep={0}
                isPlaying={false}
                onToggleStep={vi.fn()}
                onSetVelocity={onSetVelocity}
            />
        );
        const cell = screen.getAllByRole('checkbox')[1]!;
        fireEvent.pointerDown(cell, { clientY: 50, pointerId: 1, altKey: true });
        fireEvent.pointerMove(cell.parentElement!, { clientY: 0, pointerId: 1 });
        expect(onSetVelocity).toHaveBeenCalledTimes(1);
        const [padIdx, stepIdx, velocity] = onSetVelocity.mock.calls[0]!;
        expect(padIdx).toBe(0);
        expect(stepIdx).toBe(1);
        expect(velocity).toBeGreaterThan(0.5);
    });
});
