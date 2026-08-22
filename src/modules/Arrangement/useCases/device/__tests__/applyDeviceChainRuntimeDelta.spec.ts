import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { applyDeviceChainRuntimeDelta } from '../applyDeviceChainRuntimeDelta';
import { hasLiveProjectHostTrack } from '../hasLiveProjectHostTrack';

import type { Track } from '../../../stores/trackStore';

const mocks = vi.hoisted(() => ({
    applyRuntimeGraphDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    getRuntimeGraphRevision: vi.fn(() => 7),
    captureProjectRevision: vi.fn(() => 'project-1'),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    applyRuntimeGraphDelta: mocks.applyRuntimeGraphDelta,
    getRuntimeGraphRevision: mocks.getRuntimeGraphRevision,
    createRuntimeGraphTopologyFingerprint: (node: unknown) => JSON.stringify(node),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

function seedTrack(): Track {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    track.devices = [
        { id: 'device-1', name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: { frequency: 1000 } },
    ];
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    return track;
}

describe('applyDeviceChainRuntimeDelta', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('submits the delta while the host track is still project truth', () => {
        const track = seedTrack();
        const after = { ...track, devices: [] };

        const result = applyDeviceChainRuntimeDelta({ before: track, after, operation: 'remove-device' });

        expect(result).toEqual({ acceptance: 'accepted', application: 'applied' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
    });

    it('reports a delta superseded, without submitting it, once the host track left project truth', () => {
        // Every deferred device-chain effect compiles its snapshots while the
        // action executes but submits them after the whole batch commits. A
        // later action in the same commit that removed the host track leaves the
        // snapshot describing a track project truth no longer has: the engine
        // would reject it as a topology mismatch for a removal that already
        // happened.
        const track = seedTrack();
        const after = { ...track, devices: [] };
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        const result = applyDeviceChainRuntimeDelta({ before: track, after, operation: 'remove-device' });

        expect(result).toEqual({
            acceptance: 'superseded',
            application: 'not-applied',
            reason: 'Track audio-1 left project truth before its remove-device delta was submitted',
        });
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('keeps submitting a delta whose host track is present but no longer matches', () => {
        // Narrowness matters: only the track leaving project truth makes a delta
        // void. A track that is still there and diverged is a genuine mismatch,
        // and the engine has to be the one that says so.
        const track = seedTrack();
        mocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta does not match the current project topology',
        } as never);
        trackStore.set({
            tracks: [{ ...track, devices: [...track.devices, { ...track.devices[0]!, id: 'device-2' }] }],
            selectedTrackId: track.id,
            ghostClips: [],
        });

        const result = applyDeviceChainRuntimeDelta({
            before: track,
            after: { ...track, devices: [] },
            operation: 'remove-device',
        });

        expect(result).toMatchObject({ acceptance: 'rejected' });
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
    });

    it('exposes the same host-track decision to callers that never submit a delta', () => {
        seedTrack();

        expect(hasLiveProjectHostTrack('audio-1')).toBe(true);
        expect(hasLiveProjectHostTrack('missing-1')).toBe(false);
    });
});
