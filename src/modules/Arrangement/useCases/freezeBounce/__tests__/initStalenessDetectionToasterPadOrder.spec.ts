import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

import { type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { createTrack } from '../../createTrack';
import { digestFreezePrintInput } from '../digestFreezePrintInput';
import { initStalenessDetection } from '../initStalenessDetection';
import { readLiveFreezePrintInput } from '../readLiveFreezePrintInput';

const TOASTER_ID = 'track-toaster';

const toaster = createTrack({ id: TOASTER_ID, name: 'Toaster', kind: 'folder' });
// A pad child routes into its Toaster, which is how the freeze's subgraph reaches it.
const padOne = {
    ...createTrack({ id: 'track-pad-1', name: 'Pad 1', kind: 'midi' }),
    parentId: TOASTER_ID,
    outputId: TOASTER_ID,
};
const padTwo = {
    ...createTrack({ id: 'track-pad-2', name: 'Pad 2', kind: 'midi' }),
    parentId: TOASTER_ID,
    outputId: TOASTER_ID,
};
const toasterWithDevice: Track = {
    ...toaster,
    devices: [{ id: 'device-toaster', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
};

function findToaster(): Track {
    const found = trackStore.value?.tracks.find((track) => track.id === TOASTER_ID);
    if (!found) {
        throw new Error('the Toaster track is missing');
    }
    return found;
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: null });
}

describe('initStalenessDetection Toaster pad order', () => {
    let stopStaleness = () => {};

    beforeEach(() => {
        setTracks([toasterWithDevice, padOne, padTwo]);
        const input = readLiveFreezePrintInput(TOASTER_ID);
        if (!input) {
            throw new Error('the Toaster has no print input');
        }
        const frozen: Track = {
            ...toasterWithDevice,
            freezeState: {
                status: 'frozen',
                sourceContentHash: digestFreezePrintInput(input),
                renderSettings: {
                    sampleRate: 44_100,
                    bitDepth: 32,
                    channelCount: 2,
                    tailLengthSeconds: 0,
                    bakeVersion: FREEZE_BAKE_VERSION,
                },
            },
        };
        setTracks([frozen, padOne, padTwo]);
        stopStaleness = initStalenessDetection();
    });

    afterEach(() => {
        stopStaleness();
        setTracks([]);
    });

    it('marks a frozen Toaster stale when two of its pad children swap places', async () => {
        setTracks([findToaster(), padTwo, padOne]);

        await vi.waitFor(() => {
            expect(findToaster().freezeState.status).toBe('stale');
        });
    });

    it('keeps a frozen Toaster frozen when its pad children keep their places', () => {
        setTracks([findToaster(), padOne, padTwo]);

        expect(findToaster().freezeState.status).toBe('frozen');
    });
});
