import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PitchBendLane } from '../PitchBendLane';

const mocks = vi.hoisted(() => ({
    writes: {
        addPitchBend: vi.fn(),
        removePitchBend: vi.fn(),
        movePitchBend: vi.fn(),
        restorePitchBend: vi.fn(),
        pushUndoEntry: vi.fn(),
    },
    notifyUser: vi.fn(),
    playheadBeat: 1 as number | undefined,
    midiState: {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: { 'clip-1': [{ id: 'pb-1', value: 100, beat: 2 }] },
    },
    trackState: { tracks: [] as Array<{ id: string; frozen: boolean; clips: Array<{ id: string }> }> },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return mocks.midiState;
        },
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: mocks.writes.pushUndoEntry }));
vi.mock('#/modules/MIDI/useCases', () => ({
    addPitchBend: mocks.writes.addPitchBend,
    removePitchBend: mocks.writes.removePitchBend,
    movePitchBend: mocks.writes.movePitchBend,
    restorePitchBend: mocks.writes.restorePitchBend,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('../../../helpers/clipPlayheadBeat', () => ({ readClipPlayheadBeat: () => mocks.playheadBeat }));

const FROZEN_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';

const writeCallCount = (): number =>
    Object.values(mocks.writes).reduce((total, writer) => total + writer.mock.calls.length, 0);

const frozenWarnings = (): unknown[][] =>
    mocks.notifyUser.mock.calls.filter((call) => call[0] === FROZEN_MESSAGE && call[1] === 'warning');

const getPoint = (): HTMLElement => {
    const point = screen.getByRole('toolbar').querySelector<HTMLElement>('[data-pb-point]');
    expect(point).not.toBeNull();
    return point!;
};

const gestures: Array<{ name: string; perform: () => void }> = [
    { name: 'clicking the lane to add a point', perform: () => fireEvent.click(screen.getByRole('toolbar')) },
    {
        name: 'pressing Enter to insert a point at the playhead',
        perform: () => fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'Enter' }),
    },
    {
        name: 'dragging a point',
        perform: () => {
            fireEvent.pointerDown(getPoint(), { pointerId: 1, button: 0 });
            fireEvent.pointerMove(screen.getByRole('toolbar'), { pointerId: 1, clientX: 90, clientY: 5 });
            fireEvent.pointerUp(screen.getByRole('toolbar'), { pointerId: 1 });
        },
    },
    { name: 'double-clicking a point to remove it', perform: () => fireEvent.doubleClick(getPoint()) },
];

describe('PitchBendLane on a frozen track', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.playheadBeat = 1;
        mocks.writes.addPitchBend.mockReturnValue({ id: 'pb-new', value: 1, beat: 1 });
    });

    afterEach(() => {
        cleanup();
    });

    describe.each(gestures)('$name', ({ perform }) => {
        it('writes nothing and warns once when the clip track is frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];
            render(<PitchBendLane clipId="clip-1" beatWidth={40} contentWidth={800} />);

            perform();

            expect(writeCallCount()).toBe(0);
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('still writes with no frozen warning when the track is not frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: false, clips: [{ id: 'clip-1' }] }];
            render(<PitchBendLane clipId="clip-1" beatWidth={40} contentWidth={800} />);

            perform();

            expect(writeCallCount()).toBeGreaterThan(0);
            expect(frozenWarnings()).toHaveLength(0);
        });
    });

    it('does not warn for Enter when the playhead is outside the clip, which inserts nothing', () => {
        mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];
        mocks.playheadBeat = undefined;
        render(<PitchBendLane clipId="clip-1" beatWidth={40} contentWidth={800} />);

        fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'Enter' });

        expect(writeCallCount()).toBe(0);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
