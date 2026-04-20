import { describe, it, expect, vi, beforeEach } from 'vitest';

import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';

import { restoreSnapshot } from '../snapshotHelpers/restoreSnapshot';

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { set: vi.fn(), value: null },
}));
vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: { set: vi.fn(), value: null },
}));
vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: { set: vi.fn(), value: null },
}));
vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: { set: vi.fn(), value: null },
}));
vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { set: vi.fn(), value: null },
}));

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

describe('restoreSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should parse snapshot data into stores', () => {
        const payload = {
            tracks: { tracks: [], selectedTrackId: null },
            markers: [],
            transport: { playheadPosition: 0 },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            automation: { lanes: [] },
        };

        restoreSnapshot({
            data: JSON.stringify(payload),
            size: 10,
        });

        expect(trackStore.set).toHaveBeenCalledWith(payload.tracks);
        expect(markerStore.set).toHaveBeenCalledWith(payload.markers);
        expect(transportStore.set).toHaveBeenCalledWith(payload.transport);
        expect(midiStore.set).toHaveBeenCalledWith(payload.midi);
        expect(automationStore.set).toHaveBeenCalledWith(payload.automation);
    });

    it('should log when snapshot JSON is corrupt', () => {
        restoreSnapshot({ data: '{not json', size: 1 });

        expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Error));
    });
});
