import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type MidiLearnState } from '#/modules/MIDI/stores/midiLearnStore';
import { startMidiLearn } from '#/modules/MIDI/useCases/midiLearn/startMidiLearn';

import { RotaryKnob, type GestureAuthority } from '../RotaryKnob';

const baseMidiState: MidiLearnState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

let mockMidiState: MidiLearnState = { ...baseMidiState };

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => mockMidiState),
}));
vi.mock('#/modules/MIDI/useCases/midiLearn/startMidiLearn', () => ({
    startMidiLearn: vi.fn(),
}));

describe('RotaryKnob', () => {
    beforeEach(() => {
        mockMidiState = { ...baseMidiState };
        vi.mocked(startMidiLearn).mockClear();
    });

    it('should render label', () => {
        render(<RotaryKnob value={50} onChange={vi.fn()} label="Gain" />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('should reset to default on double click', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={10} onChange={onChange} defaultValue={50} min={0} max={100} />);
        fireEvent.doubleClick(container.firstChild as HTMLElement);
        // Reset to default is a committed change, not a transient drag — isTransient is false.
        expect(onChange).toHaveBeenCalledWith(50, false);
    });

    it('does not emit a reset when the value is already the default', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} defaultValue={50} />);
        const root = container.firstChild as HTMLElement;

        fireEvent.doubleClick(root);
        fireEvent.pointerDown(root, { button: 0, pointerId: 9, altKey: true });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('should drag and quantize value', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 1, clientY: 80 });
        fireEvent.pointerUp(root, { pointerId: 1 });
        expect(onChange).toHaveBeenCalled();
    });

    it('does not commit a press and release with no value change', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = container.firstChild as HTMLElement;

        fireEvent.pointerDown(root, { button: 0, pointerId: 8, clientY: 100 });
        fireEvent.pointerUp(root, { pointerId: 8 });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('commits the latest transient value when a drag is cancelled', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.pointerDown(root, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 4, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        fireEvent.pointerCancel(root, { pointerId: 4 });

        expect(onChange.mock.calls.at(-1)).toEqual([transientValue, false]);
    });

    it('commits the latest transient value when unmounted during a drag', () => {
        const onChange = vi.fn();
        const { container, unmount } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = container.firstChild as HTMLElement;

        fireEvent.pointerDown(root, { button: 0, pointerId: 6, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 6, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        unmount();

        expect(onChange.mock.calls).toEqual([
            [transientValue, true],
            [transientValue, false],
        ]);
    });

    it('uses the latest owner callback when teardown finalizes the drag', () => {
        const initialOnChange = vi.fn();
        const latestOnChange = vi.fn();
        const { container, rerender, unmount } = render(
            <RotaryKnob value={50} onChange={initialOnChange} min={0} max={100} gestureOwner="stable" />
        );
        const root = container.firstChild as HTMLElement;

        fireEvent.pointerDown(root, { button: 0, pointerId: 9, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 9, clientY: 80 });
        const transientValue = initialOnChange.mock.calls.at(-1)?.[0] as number;

        rerender(
            <RotaryKnob value={transientValue} onChange={latestOnChange} min={0} max={100} gestureOwner="stable" />
        );
        unmount();

        expect(initialOnChange).toHaveBeenCalledTimes(1);
        expect(latestOnChange).toHaveBeenCalledWith(transientValue, false);
    });

    it('rejects stale moves and finalization synchronously after authority takeover', () => {
        let currentToken = 0;
        const authority: GestureAuthority = {
            acquire: () => {
                currentToken += 1;
                return currentToken;
            },
            isCurrent: (token) => token === currentToken,
        };
        const firstOnChange = vi.fn();
        const secondOnChange = vi.fn();
        const { container } = render(
            <>
                <RotaryKnob value={50} onChange={firstOnChange} min={0} max={100} gestureAuthority={authority} />
                <RotaryKnob value={50} onChange={secondOnChange} min={0} max={100} gestureAuthority={authority} />
            </>
        );
        const [firstRoot, secondRoot] = Array.from(container.querySelectorAll<HTMLElement>('.cursor-ns-resize'));
        if (!firstRoot || !secondRoot) {
            throw new Error('Expected both rotary controls');
        }

        fireEvent.pointerDown(firstRoot, { button: 0, pointerId: 10, clientY: 100 });
        fireEvent.pointerMove(firstRoot, { pointerId: 10, clientY: 80 });
        const firstTransientCount = firstOnChange.mock.calls.length;

        fireEvent.pointerDown(secondRoot, { button: 0, pointerId: 11, clientY: 100 });
        fireEvent.pointerMove(secondRoot, { pointerId: 11, clientY: 70 });
        fireEvent.pointerMove(firstRoot, { pointerId: 10, clientY: 40 });
        fireEvent.pointerUp(firstRoot, { pointerId: 10 });
        fireEvent.pointerUp(secondRoot, { pointerId: 11 });

        expect(firstOnChange).toHaveBeenCalledTimes(firstTransientCount);
        expect(firstOnChange).not.toHaveBeenLastCalledWith(expect.any(Number), false);
        expect(secondOnChange).toHaveBeenCalledTimes(2);
        expect(secondOnChange).toHaveBeenLastCalledWith(expect.any(Number), false);
    });

    it('does not commit again after lost pointer capture has finalized the drag', () => {
        const onChange = vi.fn();
        const { container, unmount } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = container.firstChild as HTMLElement;

        fireEvent.pointerDown(root, { button: 0, pointerId: 7, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 7, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        fireEvent.lostPointerCapture(root, { pointerId: 7 });
        fireEvent.pointerUp(root, { pointerId: 7 });
        unmount();

        expect(onChange.mock.calls).toEqual([
            [transientValue, true],
            [transientValue, false],
        ]);
    });

    it.each([
        ['pointerup', (root: HTMLElement, _unmount: () => void) => fireEvent.pointerUp(root, { pointerId: 16 })],
        [
            'pointercancel',
            (root: HTMLElement, _unmount: () => void) => fireEvent.pointerCancel(root, { pointerId: 16 }),
        ],
        [
            'lost pointer capture',
            (root: HTMLElement, _unmount: () => void) => fireEvent.lostPointerCapture(root, { pointerId: 16 }),
        ],
        ['unmount', (_root: HTMLElement, unmount: () => void) => unmount()],
    ])('does not finalize a stale drag after an authoritative replacement via %s', (_end, endGesture) => {
        const onChange = vi.fn();
        const { container, rerender, unmount } = render(
            <RotaryKnob value={50} onChange={onChange} min={0} max={100} gestureOwner="initial" />
        );
        const root = container.firstChild as HTMLElement;

        fireEvent.pointerDown(root, { button: 0, pointerId: 16, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 16, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        rerender(<RotaryKnob value={20} onChange={onChange} min={0} max={100} gestureOwner="replacement" />);
        endGesture(root, unmount);

        expect(onChange.mock.calls).toEqual([[transientValue, true]]);
    });

    it('keeps the first pointer as drag owner when another pointer cancels', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = container.firstChild as HTMLElement;

        fireEvent.pointerDown(root, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 4, clientY: 90 });
        fireEvent.pointerDown(root, { button: 0, pointerId: 5, clientY: 50 });
        fireEvent.pointerCancel(root, { pointerId: 5 });
        fireEvent.pointerMove(root, { pointerId: 4, clientY: 70 });
        fireEvent.pointerUp(root, { pointerId: 4 });

        expect(onChange.mock.calls).toEqual([
            [56.5, true],
            [70, true],
            [70, false],
        ]);
    });

    it('should apply shift fine mode during drag', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} step={1} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.pointerDown(root, { button: 0, pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 2, clientY: 90, shiftKey: true });
        expect(onChange).toHaveBeenCalled();
    });

    it('should ignore non-left pointer down', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.pointerDown(root, { button: 2, pointerId: 3 });
        fireEvent.pointerMove(root, { pointerId: 3, clientY: 10 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should show learning overlay when this param is targeted', () => {
        mockMidiState = {
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'fermenterGlobalParam',
                trackId: 'global',
                paramId: 'p-learn',
            },
        };
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} paramId="p-learn" />);
        expect(container.querySelector('.border-dashed')).toBeInTheDocument();
    });

    it('should show mapped dot when param has a mapping', () => {
        mockMidiState = {
            isLearning: false,
            learningTarget: null,
            mappings: [
                {
                    id: 'm1',
                    channel: 1,
                    cc: 1,
                    targetType: 'fermenterGlobalParam',
                    trackId: 'global',
                    paramId: 'p-mapped',
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} paramId="p-mapped" />);
        expect(container.querySelector('.size-2.rounded-full')).toBeInTheDocument();
    });

    it('should start midi learn from context menu when paramId is set', () => {
        const { container } = render(
            <RotaryKnob
                value={50}
                onChange={vi.fn()}
                paramId="p-ctx"
                targetType="deviceParam"
                trackId="t1"
                deviceId="d1"
            />
        );
        fireEvent.contextMenu(container.firstChild as HTMLElement);
        expect(startMidiLearn).toHaveBeenCalledWith({
            targetType: 'deviceParam',
            paramId: 'p-ctx',
            trackId: 't1',
            deviceId: 'd1',
        });
    });

    it('should render bipolar arc when bipolar is enabled', () => {
        const { container } = render(
            <RotaryKnob value={25} onChange={vi.fn()} bipolar min={0} max={100} defaultValue={50} />
        );
        const arc = container.querySelector('[style*="conic-gradient"]');
        expect(arc).toBeTruthy();
    });

    it('should render bipolar arc for values past center', () => {
        const { container } = render(<RotaryKnob value={75} onChange={vi.fn()} bipolar min={0} max={100} />);
        const arc = container.querySelector('[style*="conic-gradient"]');
        expect(arc).toBeTruthy();
    });

    it('should render xl size indicator dimensions', () => {
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} size="xl" />);
        const indicator = container.querySelector('[style*="12%"]');
        expect(indicator).toBeTruthy();
    });

    it('should render without label', () => {
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} />);
        expect(container.querySelector('span')).toBeNull();
    });

    it('should render arc with every tone variant', () => {
        const tones = [
            'neutral',
            'amber',
            'cyan',
            'peach',
            'lavender',
            'mint',
            'steel',
            'danger',
            'rose',
            'indigo',
            'sage',
            'copper',
        ] as const;
        for (const tone of tones) {
            const { container, unmount } = render(
                <RotaryKnob value={50} onChange={vi.fn()} min={0} max={100} tone={tone} />
            );
            expect(container.querySelector('[style*="conic-gradient"]')).toBeTruthy();
            unmount();
        }
    });
});
