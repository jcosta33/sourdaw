/**
 * Opening a clip scrolls the roll onto its notes once. jsdom has no layout, so
 * the scroll container's client size is stubbed; the scroll itself is the real
 * `scrollTop` the component assigns. Expected values restate the roll's
 * geometry: a 22px ruler then 16px rows, row 0 = pitch 83, viewport 300px
 * tall, so a span centred at y is scrolled to y - (300 + 22) / 2.
 */
import { render, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { PianoRoll } from '../PianoRoll';

const { holder, trackState, projectState } = vi.hoisted(() => ({
    holder: { midi: { notesByClipId: {} as Record<string, unknown[]>, ccByClipId: {}, pitchBendByClipId: {} } },
    trackState: { tracks: [], selectedTrackId: null },
    projectState: { keyRoot: 0, scaleName: 'chromatic' },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return holder.midi;
        },
        getSnapshot: () => holder.midi,
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return trackState;
        },
        getSnapshot: () => trackState,
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    },
}));

vi.mock('#/infra/store/useStore', async () => {
    const { projectStore } = await import('#/modules/Project/stores');
    return {
        useStore: vi.fn((store: { value: unknown }, fallback?: unknown) =>
            store === projectStore ? projectState : (fallback ?? store.value)
        ),
    };
});

vi.mock('../../../hooks/usePianoRollRenderer', () => ({
    usePianoRollRenderer: vi.fn(() => vi.fn()),
}));

vi.mock('../../../hooks/usePianoRollInteractions', () => ({
    usePianoRollInteractions: vi.fn(() => ({
        handleMouseDown: vi.fn(),
        handleMouseMove: vi.fn(),
        handleMouseUp: vi.fn(),
        handleDoubleClick: vi.fn(),
        handleKeyDown: vi.fn(),
        handleContextMenu: vi.fn(),
        ctxMenu: null,
        setCtxMenu: vi.fn(),
        hoverCursor: 'crosshair',
    })),
}));

vi.mock('../PianoRollToolbar', () => ({ PianoRollToolbar: () => <div /> }));
vi.mock('../PianoRollContextMenu', () => ({ PianoRollContextMenu: () => <div /> }));
vi.mock('../../AutomationLane/NotePropertyLane', () => ({ NotePropertyLane: () => <div /> }));

const note = (id: string, pitch: number, startBeat = 0): Record<string, unknown> => ({
    id,
    pitch,
    startBeat,
    duration: 1,
    velocity: 100,
});

const setNotes = (clipId: string, notes: unknown[]): void => {
    holder.midi = { ...holder.midi, notesByClipId: { ...holder.midi.notesByClipId, [clipId]: notes } };
};

const props = {
    trackId: 'track-1',
    selectedNoteIds: new Set<string>(),
    onSelectedNoteIdsChange: vi.fn(),
};

// C3..E3 = rows 35..31, span 518..598, centre 558.
const C3_E3_SCROLL_TOP = 558 - 161;
// Middle C (row 23) centre 398.
const MIDDLE_C_SCROLL_TOP = 398 - 161;
// A4 (pitch 69), row 14, span 246..262.
const A4_SCROLL_TOP = 254 - 161;

const scroller = (container: HTMLElement): HTMLElement => {
    const element = container.querySelector('canvas')?.parentElement?.parentElement;
    if (!(element instanceof HTMLElement)) {
        throw new Error('piano roll scroll container not found');
    }
    return element;
};

describe('PianoRoll opening scroll', () => {
    beforeEach(() => {
        holder.midi = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('opens on the clip notes, not the top row', () => {
        setNotes('clip-1', [note('a', 48), note('b', 52)]);
        const { container } = render(<PianoRoll clipId="clip-1" {...props} />);
        expect(scroller(container).scrollTop).toBe(C3_E3_SCROLL_TOP);
    });

    it('does not move the view when notes change afterwards', () => {
        setNotes('clip-1', [note('a', 48), note('b', 52)]);
        const { container, rerender } = render(<PianoRoll clipId="clip-1" {...props} />);
        const view = scroller(container);
        setNotes('clip-1', [note('a', 48), note('b', 52), note('c', 80)]);
        rerender(<PianoRoll clipId="clip-1" {...props} />);
        expect(view.scrollTop).toBe(C3_E3_SCROLL_TOP);
    });

    it('re-applies when a different clip is opened', () => {
        setNotes('clip-1', [note('a', 48), note('b', 52)]);
        setNotes('clip-2', [note('c', 69)]);
        const { container, rerender } = render(<PianoRoll clipId="clip-1" {...props} />);
        rerender(<PianoRoll clipId="clip-2" {...props} />);
        expect(scroller(container).scrollTop).toBe(A4_SCROLL_TOP);
    });

    it('opens an empty clip on middle C, then follows notes that arrive before any input', () => {
        const { container, rerender } = render(<PianoRoll clipId="clip-1" {...props} />);
        const view = scroller(container);
        expect(view.scrollTop).toBe(MIDDLE_C_SCROLL_TOP);

        setNotes('clip-1', [note('a', 48), note('b', 52)]);
        rerender(<PianoRoll clipId="clip-1" {...props} />);
        expect(view.scrollTop).toBe(C3_E3_SCROLL_TOP);
    });

    it('does not follow late notes once the user scrolled', () => {
        const { container, rerender } = render(<PianoRoll clipId="clip-1" {...props} />);
        const view = scroller(container);
        act(() => {
            view.scrollTop = 40;
            fireEvent.scroll(view);
        });
        setNotes('clip-1', [note('a', 48), note('b', 52)]);
        rerender(<PianoRoll clipId="clip-1" {...props} />);
        expect(view.scrollTop).toBe(40);
    });

    it('does not follow a note drawn into an empty clip', () => {
        const { container, rerender } = render(<PianoRoll clipId="clip-1" {...props} />);
        const view = scroller(container);
        fireEvent.mouseDown(container.querySelector('canvas')!);
        setNotes('clip-1', [note('a', 83)]);
        rerender(<PianoRoll clipId="clip-1" {...props} />);
        expect(view.scrollTop).toBe(MIDDLE_C_SCROLL_TOP);
    });

    it('leaves the scroll alone when the viewport has no height yet', () => {
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0);
        setNotes('clip-1', [note('a', 48)]);
        const { container } = render(<PianoRoll clipId="clip-1" {...props} />);
        expect(scroller(container).scrollTop).toBe(0);
    });
});
