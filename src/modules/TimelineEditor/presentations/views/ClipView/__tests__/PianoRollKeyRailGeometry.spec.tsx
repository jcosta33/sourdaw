/**
 * The key rail's labels must sit beside the note rows they name. The rail
 * labels and the canvas click hit-test both derive row positions from
 * `getPianoRollRowTop` / `getPianoRollRowAtY`, and the canvas places its row
 * origin at `getPianoRollRowTop(0)` (asserted in usePianoRollRenderer.spec.ts).
 * jsdom has no layout, so the rail is asserted on the top/height values the
 * component sets. Runs against the real `pianoRollConstants`: the sibling
 * PianoRoll specs replace it with probe values and could not observe a label
 * drifting off the real row grid.
 *
 * Regression: the rail was a flex column of height-only labels. Stretched to a
 * dock shorter than the roll, flex shrank the ruler header to its border and
 * every label to its text height (16px -> 15px), so a label drifted a pixel per
 * row off the canvas row and a click on "G5" created an A5.
 */
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import {
    ROW_HEIGHT,
    RULER_HEIGHT,
    getPianoRollContentHeight,
    getPianoRollRowAtY,
    getPianoRollRowTop,
    getVisiblePitches,
} from '../../../helpers/pianoRollConstants';
import { PianoRoll } from '../PianoRoll';

const { midiState, trackState, projectState } = vi.hoisted(() => ({
    midiState: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    trackState: { tracks: [], selectedTrackId: null },
    projectState: { keyRoot: 0, scaleName: 'chromatic' },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiState;
        },
        getSnapshot: () => midiState,
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

vi.mock('../PianoRollToolbar', () => ({
    PianoRollToolbar: ({ onToggleFolded }: { onToggleFolded: () => void }) => (
        <button type="button" onClick={onToggleFolded}>
            fold
        </button>
    ),
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: () => <div />,
}));

vi.mock('../../AutomationLane/NotePropertyLane', () => ({
    NotePropertyLane: () => <div />,
}));

const props = {
    clipId: 'clip-1',
    trackId: 'track-1',
    selectedNoteIds: new Set<string>(),
    onSelectedNoteIdsChange: vi.fn(),
};

const renderRoll = (): { rail: HTMLElement; scroller: HTMLElement } => {
    const { container } = render(<PianoRoll {...props} />);
    const canvas = container.querySelector('canvas');
    const rail = canvas?.parentElement?.previousElementSibling;
    const scroller = rail?.parentElement;
    if (!(rail instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
        throw new Error('piano roll key rail not found beside the canvas');
    }
    return { rail, scroller };
};

const pxOf = (value: string): number => Number.parseFloat(value);

const expectLabelBesideRow = (label: HTMLElement, pitch: number, visiblePitches: number[]): void => {
    const row = visiblePitches.indexOf(pitch);
    expect(label.classList.contains('absolute')).toBe(true);
    expect(pxOf(label.style.top)).toBe(getPianoRollRowTop(row));
    expect(pxOf(label.style.height)).toBe(ROW_HEIGHT);
    // The label's centre is a click on the canvas row that creates this pitch.
    const centerY = pxOf(label.style.top) + pxOf(label.style.height) / 2;
    const rowAtCenter = getPianoRollRowAtY(centerY, visiblePitches.length);
    expect(rowAtCenter === null ? null : visiblePitches[rowAtCenter]).toBe(pitch);
};

describe('PianoRoll key rail geometry', () => {
    it('places each key label on the canvas row of its pitch and sizes the rail to the canvas', () => {
        projectState.scaleName = 'chromatic';
        projectState.keyRoot = 0;
        const visiblePitches = getVisiblePitches('chromatic', 0, false);
        const { rail } = renderRoll();

        // G5 = pitch 79, the label from the reported defect; the others pin
        // the first row, a mid row and the last row.
        for (const [name, pitch] of [
            ['B5', 83],
            ['G5', 79],
            ['C4', 60],
            ['C1', 24],
        ] as const) {
            expectLabelBesideRow(screen.getByText(name), pitch, visiblePitches);
        }
        expect(pxOf(rail.style.height)).toBe(getPianoRollContentHeight(visiblePitches.length));
    });

    it('pins the ruler header to the top at the ruler height so it cannot shrink', () => {
        projectState.scaleName = 'chromatic';
        const { rail } = renderRoll();
        const header = rail.firstElementChild;
        if (!(header instanceof HTMLElement)) {
            throw new Error('ruler header missing');
        }
        expect(header.classList.contains('absolute')).toBe(true);
        expect(pxOf(header.style.height)).toBe(RULER_HEIGHT);
    });

    it('keeps every label on its row after the roll scrolls vertically', () => {
        projectState.scaleName = 'chromatic';
        const visiblePitches = getVisiblePitches('chromatic', 0, false);
        const { scroller } = renderRoll();
        const g5 = screen.getByText('G5');
        const topBefore = g5.style.top;

        scroller.scrollTop = 300;
        fireEvent.scroll(scroller);

        expect(g5.style.top).toBe(topBefore);
        expectLabelBesideRow(g5, 79, visiblePitches);
    });

    it('re-derives label rows when folding to the scale drops pitches', () => {
        projectState.scaleName = 'major';
        projectState.keyRoot = 0;
        const { rail } = renderRoll();
        fireEvent.click(screen.getByText('fold'));

        const folded = getVisiblePitches('major', 0, true);
        expect(folded.length).toBeLessThan(60);
        expect(pxOf(rail.style.height)).toBe(getPianoRollContentHeight(folded.length));
        // F#5 (pitch 78) is out of C major: no label, and G5 moved up a row.
        expect(screen.queryByText('F#5')).toBeNull();
        expectLabelBesideRow(screen.getByText('G5'), 79, folded);
    });
});
