import { fireEvent, render, screen } from '@testing-library/react';
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
    it('releases an owned press when the window loses focus', () => {
        const release = vi.fn();
        render(<PadGrid pads={[makePad(0)]} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={() => release} />);
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        fireEvent.blur(window);
        expect(release).toHaveBeenCalledOnce();
    });

    it('should render', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('P0')).toBeInTheDocument();
    });

    it('owns pointer and keyboard presses independently and ignores repeat', () => {
        const releases = [vi.fn(), vi.fn()];
        const acquire = vi.fn().mockReturnValueOnce(releases[0]).mockReturnValueOnce(releases[1]);
        render(<PadGrid pads={[makePad(0)]} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={acquire} />);
        const pad = screen.getByRole('button');
        fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' });
        fireEvent.keyDown(pad, { key: 'Enter' });
        fireEvent.keyDown(pad, { key: 'Enter', repeat: true });
        expect(acquire).toHaveBeenCalledTimes(2);
        fireEvent.keyUp(pad, { key: 'Enter' });
        expect(releases[1]).toHaveBeenCalledOnce();
        expect(releases[0]).not.toHaveBeenCalled();
        fireEvent.pointerLeave(pad, { pointerId: 1 });
        expect(releases[0]).toHaveBeenCalledOnce();
        fireEvent.pointerUp(pad, { pointerId: 1 });
        expect(releases[0]).toHaveBeenCalledOnce();
    });

    it('releases the original press after reorder and on unmount', () => {
        const first = vi.fn();
        const second = vi.fn();
        const acquire = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
        const pads = [makePad(0), makePad(1)];
        const props = { selectedIndex: 0, onSelectPad: vi.fn(), onTriggerPad: acquire };
        const view = render(<PadGrid {...props} pads={pads} />);
        const firstPad = screen.getByRole('button', { name: 'P0 (empty)' });
        fireEvent.keyDown(firstPad, { key: ' ' });
        view.rerender(<PadGrid {...props} pads={[pads[1]!, pads[0]!]} />);
        expect(first).toHaveBeenCalledOnce();

        fireEvent.keyDown(firstPad, { key: 'Enter' });
        expect(second).not.toHaveBeenCalled();
        view.unmount();
        expect(second).toHaveBeenCalledOnce();
        expect(first).toHaveBeenCalledOnce();
    });
    it('retires a moved hold before a new pad takes the same key', () => {
        const first = vi.fn();
        const second = vi.fn();
        const acquire = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
        const pads = [makePad(0), makePad(1)];
        const props = { selectedIndex: 0, onSelectPad: vi.fn(), onTriggerPad: acquire };
        const view = render(<PadGrid {...props} pads={pads} />);
        const old = screen.getByRole('button', { name: 'P0 (empty)' });
        fireEvent.keyDown(old, { key: 'Enter' });
        view.rerender(<PadGrid {...props} pads={[pads[1]!, pads[0]!]} />);
        expect(first).toHaveBeenCalledOnce();
        const next = screen.getByRole('button', { name: 'P1 (empty)' });
        fireEvent.keyDown(next, { key: 'Enter' });
        fireEvent.keyUp(old, { key: 'Enter' });
        expect(second).not.toHaveBeenCalled();
        fireEvent.keyUp(next, { key: 'Enter' });
        expect(second).toHaveBeenCalledOnce();
    });

    it.each([
        ['off-pad pointer up', (_pad: HTMLElement) => fireEvent.pointerUp(document.body, { pointerId: 7 })],
        ['off-pad pointer cancel', (_pad: HTMLElement) => fireEvent.pointerCancel(document.body, { pointerId: 7 })],
        ['pointer leave', (pad: HTMLElement) => fireEvent.pointerLeave(pad, { pointerId: 7 })],
        ['lost pointer capture', (pad: HTMLElement) => fireEvent.lostPointerCapture(pad, { pointerId: 7 })],
    ])('releases immediately on %s and ignores duplicate terminals', (_name, terminal) => {
        const release = vi.fn();
        render(<PadGrid pads={[makePad(0)]} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={() => release} />);
        const pad = screen.getByRole('button');
        fireEvent.pointerDown(pad, { pointerId: 7, isPrimary: true, button: 0 });
        expect(release).not.toHaveBeenCalled();
        terminal(pad);
        expect(release).toHaveBeenCalledOnce();
        fireEvent.pointerUp(pad, { pointerId: 7 });
        fireEvent.pointerCancel(document.body, { pointerId: 7 });
        fireEvent.pointerLeave(pad, { pointerId: 7 });
        fireEvent.lostPointerCapture(pad, { pointerId: 7 });
        expect(release).toHaveBeenCalledOnce();
    });

    it('releases a held key when focus moves to another pad', () => {
        const release = vi.fn();
        render(
            <PadGrid
                pads={[makePad(0), makePad(1)]}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={() => release}
            />
        );
        const [first, second] = screen.getAllByRole('button');
        first!.focus();
        fireEvent.keyDown(first!, { key: ' ' });
        expect(release).not.toHaveBeenCalled();
        second!.focus();
        expect(release).toHaveBeenCalledOnce();
        fireEvent.keyUp(first!, { key: ' ' });
        expect(release).toHaveBeenCalledOnce();
    });
    it('releases a held pad before reordering on drop', () => {
        const release = vi.fn();
        const reorder = vi.fn(() => expect(release).toHaveBeenCalledOnce());
        render(
            <PadGrid
                pads={[makePad(0), makePad(1)]}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={() => release}
                onReorderPad={reorder}
            />
        );
        const [source, target] = screen.getAllByRole('button');
        fireEvent.keyDown(source!, { key: 'Enter' });
        fireEvent.dragStart(source!);
        fireEvent.drop(target!);
        expect(reorder).toHaveBeenCalledExactlyOnceWith(0, 1);
        fireEvent.keyUp(source!, { key: 'Enter' });
        expect(release).toHaveBeenCalledOnce();
    });
});
