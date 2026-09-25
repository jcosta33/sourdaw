import { afterEach, describe, expect, it, vi } from 'vitest';

import { togglePunchRecording } from '#/modules/PunchRecording/useCases';

const mocks = vi.hoisted(() => ({
    bridgeInvoke: vi.fn<(cmd: string, positional: readonly unknown[]) => Promise<unknown>>(),
    render: vi.fn(),
}));

vi.mock('../bootstrap', () => ({}));

vi.mock('../resolveAppComposition', () => ({
    resolveAppComposition: () => 'application',
}));

vi.mock('../ApplicationFirstPaint', () => ({ ApplicationFirstPaint: () => null }));

vi.mock('../registerNotificationEventBus', () => ({ registerNotificationEventBus: vi.fn() }));

vi.mock('../App', () => ({ App: () => null }));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    resetDisplayScaleForStartup: () => Promise.resolve(),
}));

vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render: mocks.render }),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        value: {
            tracks: [{ id: 'audio-1', kind: 'audio' }],
            selectedTrackId: 'audio-1',
        },
    },
    getTrackEligibility: (kind: string) => ({ acceptsRecording: kind === 'audio' }),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: vi.fn(),
}));

const RETROSPECTIVE_COMMANDS = new Set(['arm_retrospective_capture', 'disarm_retrospective_capture']);

function retrospectiveBridgeCalls(): unknown[][] {
    return mocks.bridgeInvoke.mock.calls.filter(([cmd]) => RETROSPECTIVE_COMMANDS.has(cmd));
}

function observeFirstRender(): Promise<void> {
    return new Promise((resolve) => {
        mocks.render.mockImplementationOnce(() => resolve());
    });
}

describe('desktop renderer startup and the retrospective capture arm', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('clears an arm inherited from an earlier renderer before the first enable of this session arms', async () => {
        document.body.innerHTML = '<div id="root"></div>';
        // The preload's bridge, stubbed where the shell publishes it, so the real
        // startup, AudioEngine use cases and repositories run and only IPC is faked.
        vi.stubGlobal('sourdaw', { invoke: mocks.bridgeInvoke });
        mocks.bridgeInvoke.mockResolvedValue(undefined);
        const rendered = observeFirstRender();

        await import('../main');
        await rendered;
        togglePunchRecording();

        await vi.waitFor(() => expect(retrospectiveBridgeCalls()).toHaveLength(2));
        expect(retrospectiveBridgeCalls()).toEqual([
            ['disarm_retrospective_capture', []],
            ['arm_retrospective_capture', ['audio-1', 2]],
        ]);
    });
});
