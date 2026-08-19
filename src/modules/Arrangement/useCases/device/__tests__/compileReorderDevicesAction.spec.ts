import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { compileReorderDevicesAction } from '../compileReorderDevicesAction';

function seedTrack(deviceIds: readonly string[] = ['device-1', 'device-2', 'device-3']): void {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    track.devices = deviceIds.map((id, index) => {
        const parameterValues: Record<string, number> = index === 1 ? { frequency: 1000 } : {};
        return {
            id,
            name: id,
            type: index === 1 ? 'builtin-eq' : 'builtin-compressor',
            bypassed: false,
            parameterValues,
        };
    });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
}

describe('compileReorderDevicesAction', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        seedTrack();
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('owns the target order and exact before-state binding for an identity-only rack drag', () => {
        const action = compileReorderDevicesAction('audio-1', 'device-1', 'device-3');

        expect(action).toMatchObject({
            type: 'reorderDevices',
            payload: {
                trackId: 'audio-1',
                deviceId: 'device-1',
                targetIndex: 2,
                expectedBefore: {
                    id: 'audio-1',
                    kind: 'audio',
                    devices: [
                        { id: 'device-1', type: 'builtin-compressor', parameterIds: [] },
                        { id: 'device-2', type: 'builtin-eq', parameterIds: ['frequency'] },
                        { id: 'device-3', type: 'builtin-compressor', parameterIds: [] },
                    ],
                },
                expectedProjectRevision: expect.any(String),
            },
        });
    });

    it('rejects malformed identity intent before it reaches the Command boundary', () => {
        expect(compileReorderDevicesAction('audio-1', 'device-1', 'device-1')).toBeNull();
        expect(compileReorderDevicesAction('audio-1', 'missing', 'device-3')).toBeNull();

        seedTrack(['device-1', 'device-1', 'device-3']);
        expect(compileReorderDevicesAction('audio-1', 'device-1', 'device-3')).toBeNull();
    });
});
