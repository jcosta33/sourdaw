import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, recordingStartStore, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { handleFreezeTrack } from '../freezeTrack';

const mocks = vi.hoisted(() => ({
    freezeTrack: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/freezeTrack', () => ({ freezeTrack: mocks.freezeTrack }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const WARNING = 'Freeze is unavailable while this track is recording.';

function track(id: string, armed: boolean) {
    return {
        id,
        kind: 'audio',
        armed,
        frozen: false,
        frozenBufferId: undefined,
        freezeState: { status: 'unfrozen' },
        clips: [],
    };
}

const freezeAction = (trackId: string) =>
    ({ type: 'freezeTrack', payload: { trackId, freezeId: 'freeze-1' } }) as const;

describe('handleFreezeTrack while a recording is engaged or starting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.freezeTrack.mockResolvedValue(true);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track('armed', true), track('other', false)] });
        transportStore.set(defaultTransportState);
        recordingStartStore.set(false);
    });

    afterEach(() => {
        transportStore.set(defaultTransportState);
        recordingStartStore.set(false);
    });

    async function freezeAndExpectWarning(trackId = 'armed') {
        const result = await handleFreezeTrack.execute(freezeAction(trackId));

        expect(mocks.freezeTrack).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(WARNING, 'warning');
        return result;
    }

    it('refuses an armed track while a take is recording', async () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });

        expect(await freezeAndExpectWarning()).toEqual({ status: 'no-write' });
    });

    it('refuses an armed track while an overdub records over an existing clip', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ ...track('armed', true), clips: [{ id: 'clip-1', startBeat: 0, endBeat: 4 }] }],
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true, overdubEnabled: true });

        expect(await freezeAndExpectWarning()).toEqual({ status: 'no-write' });
    });

    it('refuses an armed track during count-in or pre-roll, before the transport is recording', async () => {
        transportStore.set({ ...defaultTransportState, countInEnabled: true, preRollEnabled: true });
        recordingStartStore.set(true);

        expect(await freezeAndExpectWarning()).toEqual({ status: 'no-write' });
    });

    it('refuses an armed track while hardware input admission is pending', async () => {
        recordingStartStore.set(true);

        expect(await freezeAndExpectWarning()).toEqual({ status: 'no-write' });
    });

    it('writes a freeze with a working inverse when the recording closed between describe and execute', async () => {
        recordingStartStore.set(true);
        const description = handleFreezeTrack.describe(freezeAction('armed'));
        recordingStartStore.set(false);

        const result = await handleFreezeTrack.execute(freezeAction('armed'));

        expect(description.inverseAction).toMatchObject({ type: 'restoreFreezeState' });
        expect(result).toEqual({ status: 'written' });
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('refuses at execute, with no write, when the recording began between describe and execute', async () => {
        const description = handleFreezeTrack.describe(freezeAction('armed'));
        recordingStartStore.set(true);

        const result = await handleFreezeTrack.execute(freezeAction('armed'));

        expect(description.inverseAction).toMatchObject({ type: 'restoreFreezeState' });
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.freezeTrack).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('freezes an armed track while the transport is idle', async () => {
        const result = await handleFreezeTrack.execute(freezeAction('armed'));

        expect(result).toEqual({ status: 'written' });
        expect(mocks.freezeTrack).toHaveBeenCalledWith('armed', 'freeze-1');
        expect(notifyUser).not.toHaveBeenCalled();
        expect(handleFreezeTrack.describe(freezeAction('armed')).inverseAction).not.toBeNull();
    });

    it('freezes an armed track after a cancelled count-in cleared the starting state', async () => {
        recordingStartStore.set(true);
        recordingStartStore.set(false);

        await handleFreezeTrack.execute(freezeAction('armed'));

        expect(mocks.freezeTrack).toHaveBeenCalledWith('armed', 'freeze-1');
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('freezes an armed track during plain playback', async () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true });

        await handleFreezeTrack.execute(freezeAction('armed'));

        expect(mocks.freezeTrack).toHaveBeenCalledTimes(1);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('freezes an unarmed track while another track records', async () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });

        await handleFreezeTrack.execute(freezeAction('other'));

        expect(mocks.freezeTrack).toHaveBeenCalledWith('other', 'freeze-1');
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
