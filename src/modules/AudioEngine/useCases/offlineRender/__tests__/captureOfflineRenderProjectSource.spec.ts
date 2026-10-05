import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type YeastProcessorInfo } from '#/modules/Yeast/stores';

import { captureOfflineRenderProjectSource } from '../captureOfflineRenderProjectSource';
import { offlineRenderCapturePorts } from '../offlineRenderCapturePorts';

const readYeastRack = vi.fn<(deviceId: string) => readonly YeastProcessorInfo[]>();

const ARPEGGIATOR: YeastProcessorInfo = { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false };

function keysTrack() {
    return {
        ...createTrack({ id: 'keys', name: 'Keys', kind: 'midi' }),
        devices: [{ id: 'yeast-1', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }],
    };
}

describe('captureOfflineRenderProjectSource', () => {
    beforeEach(() => {
        readYeastRack.mockReset().mockReturnValue([ARPEGGIATOR]);
        offlineRenderCapturePorts.yeastRacks = {
            readRack: readYeastRack,
            readStoredRack: () => undefined,
            holdsKeyedRack: () => false,
            holdsLegacyRack: () => false,
            firstDeviceInProjectOrder: () => null,
        };
        trackStore.set({
            tracks: [createTrack({ id: 'vocal', name: 'Vocal', kind: 'audio' }), keysTrack()],
            selectedTrackId: null,
            ghostClips: [],
        });
        vcaGroupStore.set({ groups: [{ id: 'vca-1', name: 'Group', gain: 0.5, muted: false, trackIds: ['vocal'] }] });
    });

    afterEach(() => {
        offlineRenderCapturePorts.yeastRacks = null;
    });

    it('reads the document through the reader and every Yeast rack outside it, keyed by the device the tracks hold', () => {
        let readingDocument = false;
        const racksReadInsideDocument: string[] = [];
        readYeastRack.mockImplementation((deviceId) => {
            if (readingDocument) {
                racksReadInsideDocument.push(deviceId);
            }
            return [ARPEGGIATOR];
        });

        const source = captureOfflineRenderProjectSource((read) => {
            readingDocument = true;
            try {
                return read();
            } finally {
                readingDocument = false;
            }
        });

        // A Yeast decode redirected into another document rebinds the live
        // session's rack view, so no rack may be read while the reader is on.
        expect(racksReadInsideDocument).toEqual([]);
        expect(readYeastRack).toHaveBeenCalledWith('yeast-1');
        expect(source.yeastProcessorsByDevice).toEqual({ 'yeast-1': [ARPEGGIATOR] });
        expect(source.tracks?.tracks.map((track) => track.id)).toEqual(['vocal', 'keys']);
        expect(source.vcaGroups).toEqual([
            { id: 'vca-1', name: 'Group', gain: 0.5, muted: false, trackIds: ['vocal'] },
        ]);
    });

    it('returns read models detached from the stores that produced them', () => {
        const source = captureOfflineRenderProjectSource();

        source.tracks?.tracks.pop();
        source.vcaGroups.pop();

        expect(trackStore.value?.tracks).toHaveLength(2);
        expect(vcaGroupStore.value?.groups).toHaveLength(1);
    });
});
