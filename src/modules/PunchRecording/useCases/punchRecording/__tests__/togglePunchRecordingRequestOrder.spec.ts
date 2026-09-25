import { afterEach, describe, expect, it, vi } from 'vitest';

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

const mockBridgeInvoke = vi.hoisted(() => vi.fn<(cmd: string, positional: readonly unknown[]) => Promise<unknown>>());

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

/** Let every queued promise reaction run: a macrotask starts only once the microtask queue is empty. */
async function drainPendingReactions(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The preload's bridge, stubbed where the shell publishes it, so the real
 * AudioEngine use cases and repositories run and only the IPC edge is faked.
 */
function publishDesktopBridge(): void {
    vi.stubGlobal('sourdaw', { invoke: mockBridgeInvoke });
}

describe('togglePunchRecording request order', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends the disarm of a quick enable-then-disable only after its arm settles', async () => {
        publishDesktopBridge();
        const arm = Promise.withResolvers<unknown>();
        mockBridgeInvoke.mockImplementation((cmd) =>
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

        await vi.waitFor(() => expect(mockBridgeInvoke).toHaveBeenCalledTimes(1));
        await drainPendingReactions();
        expect(mockBridgeInvoke.mock.calls.map(([cmd]) => cmd)).toEqual(['arm_retrospective_capture']);

        arm.resolve(undefined);

        await vi.waitFor(() => expect(mockBridgeInvoke).toHaveBeenCalledTimes(2));
        expect(mockBridgeInvoke.mock.calls).toEqual([
            ['arm_retrospective_capture', ['audio-1', 2]],
            ['disarm_retrospective_capture', []],
        ]);
    });
});
