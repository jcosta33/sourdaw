import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
    invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    listen: vi.fn<(event: string, handler: (value: unknown) => void) => Promise<() => void>>(),
    desktop: vi.fn(() => true),
}));
vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: ipc.desktop,
    desktopInvoke: ipc.invoke,
    desktopListen: ipc.listen,
}));

import { armRecording } from '../armRecording';
import { getCrumbsRecordingState } from '../getCrumbsRecordingState';
import { onCrumbsRecordingState } from '../onCrumbsRecordingState';
import { stopRecording } from '../stopRecording';

const snapshot = {
    instance_id: 'sampler',
    instance_incarnation: '9007199254740993',
    take_id: '9007199254740994',
    revision: '9007199254740995',
    phase: 'waiting',
    first_input: { position_frames: '18446744073709551614', frames: 128 },
    failure: null,
};

beforeEach(() => {
    ipc.invoke.mockReset();
    ipc.listen.mockReset().mockResolvedValue(() => undefined);
    ipc.desktop.mockReturnValue(true);
});

describe('recording wire contract', () => {
    it('decodes recording snapshots and events with lossless frame witnesses', async () => {
        ipc.invoke.mockResolvedValue(snapshot);
        expect(await getCrumbsRecordingState('sampler')).toEqual(snapshot);
        expect(ipc.invoke).toHaveBeenCalledWith('get_crumbs_recording_state', { instanceId: 'sampler' });
        const receive = vi.fn();
        await onCrumbsRecordingState(receive);
        expect(ipc.listen).toHaveBeenCalledWith('crumbs-recording-state', expect.any(Function));
        const handler = ipc.listen.mock.calls[0]?.[1];
        expect(handler).toBeDefined();
        handler?.({ payload: snapshot });
        expect(receive).toHaveBeenCalledExactlyOnceWith(snapshot);
        expect(receive.mock.calls[0]?.[0].first_input.position_frames).toBe('18446744073709551614');
    });

    it('passes the exact take id to Stop and rejects malformed lifecycle events', async () => {
        await stopRecording('sampler', '9007199254740993');
        expect(ipc.invoke).toHaveBeenCalledWith('stop_recording', {
            instanceId: 'sampler',
            takeId: '9007199254740993',
        });
        const receive = vi.fn();
        await onCrumbsRecordingState(receive);
        const handler = ipc.listen.mock.calls[0]?.[1];
        for (const malformed of [
            { ...snapshot, revision: 42 },
            { ...snapshot, instance_incarnation: '-1' },
            { ...snapshot, take_id: '01' },
            { ...snapshot, phase: 'ready' },
            { ...snapshot, first_input: null },
            { ...snapshot, first_input: { position_frames: 123, frames: 128 } },
            { ...snapshot, first_input: { position_frames: '0', frames: -1 } },
            { ...snapshot, first_input: { position_frames: '18446744073709551616', frames: 128 } },
        ]) {
            handler?.({ payload: malformed });
            ipc.invoke.mockResolvedValueOnce(malformed);
            await expect(getCrumbsRecordingState('sampler')).rejects.toThrow();
        }
        expect(receive).not.toHaveBeenCalled();
    });

    it('returns only a validated accepted token and never fabricates browser acceptance', async () => {
        ipc.invoke.mockResolvedValueOnce({ take_id: '9007199254740993' });
        await expect(armRecording('sampler', 0.1, 0, 60)).resolves.toEqual({ take_id: '9007199254740993' });
        ipc.invoke.mockResolvedValueOnce(undefined);
        await expect(armRecording('sampler', 0.1, 0, 60)).rejects.toThrow('Invalid Crumbs accepted take id');
        ipc.desktop.mockReturnValue(false);
        ipc.invoke.mockClear();
        await expect(armRecording('sampler', 0.1, 0, 60)).resolves.toBeNull();
        await expect(getCrumbsRecordingState('sampler')).resolves.toBeNull();
        await stopRecording('sampler', '7');
        await onCrumbsRecordingState(vi.fn());
        expect(ipc.invoke).not.toHaveBeenCalled();
    });
});
