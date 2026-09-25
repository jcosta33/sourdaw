import { describe, expect, it, vi } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { togglePunchRecording } from '../togglePunchRecording';

const mockPunchRecordingStore = vi.hoisted(() => {
    const store = {
        value: null as PunchRecordingState | null,
        set: (state: PunchRecordingState) => {
            store.value = state;
        },
    };
    return store;
});

const mockDesktopInvoke = vi.hoisted(() => vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>());

vi.mock('../../../stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        value: {
            tracks: [{ id: 'audio-1', kind: 'audio' }],
            selectedTrackId: 'audio-1',
        },
    },
    getTrackEligibility: (kind: string) => ({ acceptsRecording: kind === 'audio' }),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => true,
    desktopInvoke: mockDesktopInvoke,
}));

/** Let every queued promise reaction run: a macrotask starts only once the microtask queue is empty. */
async function drainPendingReactions(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('togglePunchRecording request order', () => {
    it('sends the disarm of a quick enable-then-disable only after its arm settles', async () => {
        const arm = Promise.withResolvers<unknown>();
        mockDesktopInvoke.mockImplementation((cmd) =>
            cmd === 'arm_retrospective_capture' ? arm.promise : Promise.resolve(undefined)
        );
        mockPunchRecordingStore.value = {
            captures: [],
            defaultPreRoll: 4,
            defaultPostRoll: 2,
            defaultCrossfade: 0.25,
            enabled: false,
        };

        togglePunchRecording();
        togglePunchRecording();

        await vi.waitFor(() => expect(mockDesktopInvoke).toHaveBeenCalledTimes(1));
        await drainPendingReactions();
        expect(mockDesktopInvoke.mock.calls.map(([cmd]) => cmd)).toEqual(['arm_retrospective_capture']);

        arm.resolve(undefined);

        await vi.waitFor(() => expect(mockDesktopInvoke).toHaveBeenCalledTimes(2));
        expect(mockDesktopInvoke.mock.calls).toEqual([
            ['arm_retrospective_capture', { trackId: 'audio-1', channels: 2 }],
            ['disarm_retrospective_capture'],
        ]);
    });
});
