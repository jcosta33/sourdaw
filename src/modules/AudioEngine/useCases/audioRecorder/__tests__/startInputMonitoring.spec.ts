import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { startInputMonitoring as startInputMonitoringRepo } from '../../../repositories/audioRecorder/inputMonitoring';
import { setInputMonitoringProjectAccess } from '../../../stores/inputMonitoringProjectAccess';
import { getSelectedInputId } from '../../audioDeviceSelection/getSelectedInputId';
import { inputMonitoringAdmissions } from '../inputMonitoringAdmission';
import { startInputMonitoring } from '../startInputMonitoring';
import { suspendAutoInputMonitoring } from '../suspendAutoInputMonitoring';

vi.mock('../../../repositories/audioRecorder/inputMonitoring', () => ({
    startInputMonitoring: vi.fn(),
}));

vi.mock('../../audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(),
}));

describe('startInputMonitoring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set(defaultTransportState);
        setInputMonitoringProjectAccess(null);
        inputMonitoringAdmissions.clear();
        vi.mocked(startInputMonitoringRepo).mockResolvedValue(true);
        vi.mocked(getSelectedInputId).mockReturnValue('selected-input');
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'track-1', name: 'Input', kind: 'audio', withoutDefaultDevice: true }),
                    inputMonitoring: 'on',
                },
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
    });

    it('should preserve an explicit input id', async () => {
        await startInputMonitoring('track-1', 'explicit-input');

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', 'explicit-input', expect.any(Function));
    });

    it('should preserve null as the default-device input id', async () => {
        await startInputMonitoring('track-1', null);

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', null, expect.any(Function));
    });

    it('should resolve omitted input ids from the selected input use case', async () => {
        await startInputMonitoring('track-1');

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', 'selected-input', expect.any(Function));
    });

    it('should resolve undefined input ids from the selected input use case', async () => {
        await startInputMonitoring('track-1', undefined);

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', 'selected-input', expect.any(Function));
    });
    afterEach(() => {
        setInputMonitoringProjectAccess(null);
        inputMonitoringAdmissions.clear();
    });

    it('retains committed eligible Auto intent without attaching an absent optimistic row', async () => {
        const committed = {
            ...createTrack({ id: 'track-1', name: 'Input', kind: 'audio', withoutDefaultDevice: true }),
            armed: true,
            inputMonitoring: 'auto' as const,
        };
        setInputMonitoringProjectAccess({
            hasTrack: () => true,
            readTrack: () => committed,
            subscribe: () => () => undefined,
        });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        await expect(startInputMonitoring('track-1', null)).resolves.toBe(true);
        const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
        expect(isCurrent?.()).toBe('retain');
        committed.armed = false;
        expect(isCurrent?.()).toBe(false);
        committed.armed = true;
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        expect(isCurrent?.()).toBe(false);
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });
        expect(isCurrent?.()).toBe('retain');
    });

    it('keeps committed On intent through projected Off and fences a later committed Off or missing root', async () => {
        const projected = trackStore.value?.tracks[0];
        if (!projected) {
            throw new Error('Expected monitoring track');
        }
        let committed: typeof projected | null = projected;
        setInputMonitoringProjectAccess({
            hasTrack: () => committed !== null,
            readTrack: () => committed,
            subscribe: () => () => undefined,
        });
        await startInputMonitoring('track-1', null);
        const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
        trackStore.set({ tracks: [{ ...projected, inputMonitoring: 'off' }], selectedTrackId: null });
        expect(isCurrent?.()).toBe(true);
        committed = { ...projected, inputMonitoring: 'off' };
        expect(isCurrent?.()).toBe(false);
        committed = null;
        expect(isCurrent?.()).toBe(false);
    });

    it('follows optimistic gesture intent until that same intent commits, then trusts committed cancellation', async () => {
        const projected = trackStore.value?.tracks[0];
        if (!projected) {
            throw new Error('Expected monitoring track');
        }
        let committed = { ...projected, inputMonitoring: 'auto' as 'auto' | 'on' | 'off', armed: false };
        setInputMonitoringProjectAccess({
            hasTrack: () => true,
            readTrack: () => committed,
            subscribe: () => () => undefined,
        });
        await startInputMonitoring('track-1', null);
        const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
        expect(isCurrent?.()).toBe(true);
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        expect(isCurrent?.()).toBe(true);
        committed = { ...projected, inputMonitoring: 'on' };
        expect(isCurrent?.()).toBe(true);
        committed = { ...projected, inputMonitoring: 'off' };
        expect(isCurrent?.()).toBe(false);
    });

    it('rejects optimistic On intent when its existing committed owner disappears before On commits', async () => {
        const projected = trackStore.value?.tracks[0];
        if (!projected) {
            throw new Error('Expected monitoring track');
        }
        let committed: typeof projected | null = { ...projected, inputMonitoring: 'auto', armed: false };
        setInputMonitoringProjectAccess({
            hasTrack: () => committed !== null,
            readTrack: () => committed,
            subscribe: () => () => undefined,
        });
        await startInputMonitoring('track-1', null);
        const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
        expect(isCurrent?.()).toBe(true);
        committed = null;
        expect(trackStore.value?.tracks[0]?.inputMonitoring).toBe('on');
        expect(isCurrent?.()).toBe(false);
    });

    it.each(['mode', 'input', 'kind', 'arm'] as const)(
        'follows committed %s supersession before optimistic On matches committed truth',
        async (changeKind) => {
            const projected = trackStore.value?.tracks[0];
            if (!projected) {
                throw new Error('Expected monitoring track');
            }
            const committed: typeof projected = { ...projected, inputMonitoring: 'auto', armed: true };
            setInputMonitoringProjectAccess({
                hasTrack: () => true,
                readTrack: () => committed,
                subscribe: () => () => undefined,
            });
            await startInputMonitoring('track-1', null);
            const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
            expect(isCurrent?.()).toBe(true);
            // Reusing the provider object must not rewrite the admission's initial intent.
            if (changeKind === 'mode') {
                committed.inputMonitoring = 'off';
            } else if (changeKind === 'input') {
                committed.inputId = 'new-input';
            } else if (changeKind === 'kind') {
                committed.kind = 'midi';
            } else {
                committed.armed = false;
            }
            expect(isCurrent?.()).toBe(false);
            expect(trackStore.value?.tracks[0]?.inputMonitoring).toBe('on');
        }
    );

    it('keeps current committed On through arm changes and playback after an optimistic gesture', async () => {
        const projected = trackStore.value?.tracks[0];
        if (!projected) {
            throw new Error('Expected monitoring track');
        }
        let committed: typeof projected = { ...projected, inputMonitoring: 'auto', armed: false };
        setInputMonitoringProjectAccess({
            hasTrack: () => true,
            readTrack: () => committed,
            subscribe: () => () => undefined,
        });
        await startInputMonitoring('track-1', null);
        const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        expect(isCurrent?.()).toBe(true);
        committed = { ...committed, inputMonitoring: 'on', armed: true };
        expect(isCurrent?.()).toBe(true);
        committed = { ...committed, armed: false };
        expect(isCurrent?.()).toBe(true);
    });

    it('keeps an eligible Auto grant detached during a monitoring hold until resume', async () => {
        const track = trackStore.value?.tracks[0];
        if (!track) {
            throw new Error('Expected input track');
        }
        trackStore.set({
            tracks: [{ ...track, armed: true, inputMonitoring: 'auto' }],
            selectedTrackId: null,
            ghostClips: [],
        });
        const hold = suspendAutoInputMonitoring();
        try {
            await startInputMonitoring('track-1', null);
            const isCurrent = vi.mocked(startInputMonitoringRepo).mock.calls.at(-1)?.[2];
            expect(isCurrent?.()).toBe('retain');
            hold();
            expect(isCurrent?.()).toBe(true);
        } finally {
            hold();
        }
    });
});
