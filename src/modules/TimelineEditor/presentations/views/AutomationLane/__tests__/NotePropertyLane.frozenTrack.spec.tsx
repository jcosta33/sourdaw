import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { NotePropertyLane } from '../NotePropertyLane';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
    setValue: vi.fn(),
    notifyUser: vi.fn(),
    midiState: {
        notesByClipId: {
            'clip-1': [
                { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { id: 'n2', pitch: 62, startBeat: 2, duration: 1, velocity: 100 },
            ],
        },
    },
    trackState: { tracks: [] as Array<{ id: string; frozen: boolean; clips: Array<{ id: string }> }> },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return mocks.midiState;
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/utils/UI/resolveToken', () => ({ resolveToken: vi.fn(() => '#151515') }));
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

const FROZEN_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';

const scrollContainer = (): { current: HTMLElement } => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(element, 'scrollLeft', { value: 0, writable: true, configurable: true });
    return { current: element };
};

const frozenWarnings = (): unknown[][] =>
    mocks.notifyUser.mock.calls.filter((call) => call[0] === FROZEN_MESSAGE && call[1] === 'warning');

const renderLane = (): HTMLElement => {
    const { container } = render(
        <NotePropertyLane
            clipId="clip-1"
            trackId="track-1"
            selectedNoteIds={new Set(['n1', 'n2'])}
            beatWidth={40}
            scrollRef={scrollContainer()}
            getValue={(note: { velocity: number }) => note.velocity}
            setValue={mocks.setValue}
            label="Velocity"
            undoLabel="Change velocity"
        />
    );
    return container;
};

const gestures: Array<{ name: string; perform: (container: HTMLElement) => void }> = [
    {
        name: 'painting a value on a note bar',
        perform: () => {
            const canvas = screen.getByRole('group').querySelector('canvas')!;
            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
            fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
        },
    },
    {
        name: 'drawing a shift ramp across the selection',
        perform: () => {
            const canvas = screen.getByRole('group').querySelector('canvas')!;
            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2, shiftKey: true });
            fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
        },
    },
    {
        name: 'dragging a ramp handle',
        perform: (container) => {
            const handles = container.querySelectorAll('div.cursor-ns-resize');
            expect(handles).toHaveLength(2);
            fireEvent.pointerDown(handles[1]!, { pointerId: 3 });
            fireEvent.pointerMove(handles[1]!, { pointerId: 3, clientY: 2 });
            fireEvent.pointerUp(handles[1]!, { pointerId: 3 });
        },
    },
];

describe('NotePropertyLane on a frozen track', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    describe.each(gestures)('$name', ({ perform }) => {
        it('writes nothing and warns once when the clip track is frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];

            perform(renderLane());

            expect(mocks.setValue).not.toHaveBeenCalled();
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('still writes with no frozen warning when the track is not frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: false, clips: [{ id: 'clip-1' }] }];

            perform(renderLane());

            expect(mocks.setValue).toHaveBeenCalled();
            expect(frozenWarnings()).toHaveLength(0);
        });
    });
});
