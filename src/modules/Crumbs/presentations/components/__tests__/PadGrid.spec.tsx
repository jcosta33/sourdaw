import { type ComponentProps } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type PadConfig } from '../../../models/CrumbsTypes';
import { PadGrid } from '../PadGrid';

function makePad(index: number): PadConfig {
    return {
        id: index,
        name: `P${index}`,
        color: '#333',
        sampleId: null,
        midiNote: 36 + index,
        chokeGroup: 0,
        volume: 1,
        pan: 0,
        tune: 0,
        attack: 0,
        decay: 0,
        sustain: 1,
        release: 0,
        filterCutoff: 20000,
        filterResonance: 0,
        loopMode: 'off',
        reverse: false,
        oneShot: true,
    };
}

describe('PadGrid', () => {
    it('should render', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('P0')).toBeInTheDocument();
    });

    it('releases the note on pointer up after a pointer down trigger', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPad = vi.fn();
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={onTriggerPad}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = getPad(3);

        pressPad(pad, 3);
        expect(onTriggerPad).toHaveBeenCalledWith(3);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        fireEvent.pointerUp(pad, { pointerId: 3 });
        expect(onTriggerPadOff).toHaveBeenCalledWith(3);
    });

    it('releases the note only once when pointer up is followed by pointer leave', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = getPad(0);
        pressPad(pad, 3);
        fireEvent.pointerUp(pad, { pointerId: 3 });
        fireEvent.pointerLeave(pad, { pointerId: 3 });

        expect(onTriggerPadOff).toHaveBeenCalledTimes(1);
    });

    it('releases the note on key up after a keyboard trigger', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPad = vi.fn();
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={onTriggerPad}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = screen.getByText('P5').closest('button')!;
        fireEvent.keyDown(pad, { key: 'Enter' });
        expect(onTriggerPad).toHaveBeenCalledWith(5);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        fireEvent.keyUp(pad, { key: 'Enter' });
        expect(onTriggerPadOff).toHaveBeenCalledWith(5);
    });

    it('does not release a pad that was never triggered', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = getPad(2);
        fireEvent.pointerLeave(pad, { pointerId: 3 });
        expect(onTriggerPadOff).not.toHaveBeenCalled();
    });
});

function getPad(id: number): HTMLElement {
    return screen.getByRole('button', { name: `P${id} (empty)` });
}

function pressPad(pad: HTMLElement, pointerId: number): void {
    fireEvent.pointerDown(pad, { button: 0, pointerId });
    fireEvent.mouseDown(pad, { button: 0 });
}

function renderPadGrid(overrides: Partial<ComponentProps<typeof PadGrid>> = {}) {
    const props = {
        pads: [makePad(0), makePad(1)],
        selectedIndex: 0,
        onSelectPad: vi.fn(),
        onTriggerPad: vi.fn(),
        onTriggerPadOff: vi.fn(),
    };
    return { ...render(<PadGrid {...props} {...overrides} />), ...props };
}

describe('PadGrid interruptions', () => {
    it('releases previews on focus transfer and ignores repeat on the newly focused pad', () => {
        const { onTriggerPad, onTriggerPadOff, onSelectPad } = renderPadGrid();

        const firstPad = getPad(0);
        const nextPad = getPad(1);
        act(() => firstPad.focus());
        expect(firstPad).toHaveFocus();
        fireEvent.keyDown(firstPad, { key: 'Enter' });
        expect(onTriggerPad.mock.calls).toEqual([[0]]);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        act(() => nextPad.focus());
        expect(nextPad).toHaveFocus();
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);

        fireEvent.keyDown(nextPad, { key: 'Enter', repeat: true });
        fireEvent.keyUp(nextPad, { key: 'Enter' });
        fireEvent.keyUp(firstPad, { key: 'Enter' });
        expect(onTriggerPad.mock.calls).toEqual([[0]]);
        expect(onSelectPad.mock.calls).toEqual([[0]]);
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);

        pressPad(nextPad, 8);
        expect(onTriggerPad.mock.calls).toEqual([[0], [1]]);
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
        act(() => firstPad.focus());
        expect(firstPad).toHaveFocus();
        expect(onTriggerPadOff.mock.calls).toEqual([[0], [1]]);
    });

    it('ignores key repeat and a release from a different key while one key holds a pad', () => {
        const { onTriggerPad, onTriggerPadOff, onSelectPad } = renderPadGrid();

        const pad = getPad(0);
        fireEvent.keyDown(pad, { key: ' ' });
        fireEvent.keyDown(pad, { key: ' ', repeat: true });
        expect(onTriggerPad.mock.calls).toEqual([[0]]);
        expect(onSelectPad.mock.calls).toEqual([[0]]);

        fireEvent.keyUp(pad, { key: 'Enter' });
        expect(onTriggerPadOff).not.toHaveBeenCalled();
        fireEvent.keyUp(pad, { key: ' ' });
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
    });

    it.each(['pointerCancel', 'lostPointerCapture'] as const)('releases only the matching pointer on %s', (cancel) => {
        const onTriggerPad = vi.fn();
        const liveVoices = new Set(['transport']);
        const onTriggerPadOff = vi.fn((id: number) => liveVoices.delete(`pad-${id}`));
        renderPadGrid({
            onTriggerPad: (index) => {
                liveVoices.add(`pad-${index}`);
                onTriggerPad(index);
            },
            onTriggerPadOff,
        });

        const pointerPad = getPad(0);
        const keyPad = getPad(1);
        pressPad(pointerPad, 3);
        fireEvent.keyDown(keyPad, { key: 'Enter' });
        expect(onTriggerPad.mock.calls).toEqual([[0], [1]]);
        expect(liveVoices).toEqual(new Set(['transport', 'pad-0', 'pad-1']));

        fireEvent[cancel](pointerPad, { pointerId: 9 });
        expect(onTriggerPadOff).not.toHaveBeenCalled();
        fireEvent[cancel](pointerPad, { pointerId: 3 });
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
        expect(liveVoices).toEqual(new Set(['transport', 'pad-1']));

        fireEvent.pointerUp(pointerPad, { pointerId: 3 });
        fireEvent.mouseUp(pointerPad);
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
        expect(liveVoices).toEqual(new Set(['transport', 'pad-1']));

        fireEvent.keyUp(keyPad, { key: 'Enter' });
        expect(onTriggerPadOff.mock.calls).toEqual([[0], [1]]);
        expect(liveVoices).toEqual(new Set(['transport']));
    });

    it('releases reordered pads by stable ID through the callback captured at the press', () => {
        const onTriggerPad = vi.fn();
        const originalRelease = vi.fn();
        const nextRelease = vi.fn();
        const firstPad = makePad(7);
        const secondPad = makePad(12);
        const props = { selectedIndex: 0, onSelectPad: vi.fn(), onTriggerPad };
        const { rerender, unmount } = render(
            <PadGrid {...props} pads={[firstPad, secondPad]} onTriggerPadOff={originalRelease} />
        );

        fireEvent.keyDown(getPad(7), { key: 'Enter' });
        rerender(<PadGrid {...props} pads={[secondPad, firstPad]} onTriggerPadOff={nextRelease} />);
        fireEvent.keyDown(getPad(12), { key: ' ' });
        expect(onTriggerPad.mock.calls).toEqual([[0], [0]]);
        expect(originalRelease).not.toHaveBeenCalled();
        expect(nextRelease).not.toHaveBeenCalled();

        fireEvent.keyUp(getPad(7), { key: 'Enter' });
        expect(originalRelease.mock.calls).toEqual([[7]]);
        expect(nextRelease).not.toHaveBeenCalled();
        unmount();

        expect(originalRelease.mock.calls).toEqual([[7]]);
        expect(nextRelease.mock.calls).toEqual([[12]]);
    });

    it('releases a preview if its grid unmounts before the key comes up', () => {
        const { onTriggerPad, onTriggerPadOff, unmount } = renderPadGrid();

        fireEvent.keyDown(getPad(0), { key: 'Enter' });
        expect(onTriggerPad.mock.calls).toEqual([[0]]);
        expect(onTriggerPadOff).not.toHaveBeenCalled();
        unmount();
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
    });

    it('releases all held previews on window blur and leaves no duplicate for later releases', () => {
        const { onTriggerPad, onTriggerPadOff, unmount } = renderPadGrid();

        const pointerPad = getPad(0);
        const keyPad = getPad(1);
        pressPad(pointerPad, 3);
        fireEvent.keyDown(keyPad, { key: 'Enter' });
        expect(onTriggerPad.mock.calls).toEqual([[0], [1]]);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        fireEvent.blur(window);
        expect(onTriggerPadOff.mock.calls).toEqual([[0], [1]]);
        fireEvent.pointerUp(pointerPad, { pointerId: 3 });
        fireEvent.mouseUp(pointerPad);
        fireEvent.keyUp(keyPad, { key: 'Enter' });
        unmount();
        expect(onTriggerPadOff.mock.calls).toEqual([[0], [1]]);
    });

    it('releases the pointer preview when a pad drag starts and still reorders the pads', () => {
        const onReorderPad = vi.fn();
        const { onTriggerPad, onTriggerPadOff } = renderPadGrid({ onReorderPad });

        const source = getPad(0);
        const target = getPad(1);
        pressPad(source, 3);
        expect(onTriggerPad.mock.calls).toEqual([[0]]);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        fireEvent.dragStart(source);
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
        fireEvent.dragOver(target);
        fireEvent.drop(target);
        fireEvent.dragEnd(source);
        expect(onReorderPad.mock.calls).toEqual([[0, 1]]);
        expect(onTriggerPadOff.mock.calls).toEqual([[0]]);
    });
});
