import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileAutoInputMonitoring } from '../reconcileAutoInputMonitoring';
import { syncAutoInputMonitoring } from '../syncAutoInputMonitoring';

import type { Store } from '#/infra/store/types';

type TestTrack = {
    id: string;
    kind: 'audio' | 'midi';
    armed: boolean;
    inputMonitoring: 'auto' | 'on' | 'off';
    inputId: string | null;
};

type TestTransport = { isPlaying: boolean; isRecording: boolean };

const harness = vi.hoisted(() => ({
    monitored: new Map<string, string | null>(),
    startInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
}));

vi.mock('../startInputMonitoring', () => ({ startInputMonitoring: harness.startInputMonitoring }));
vi.mock('../stopTrackInputMonitoring', () => ({ stopTrackInputMonitoring: harness.stopTrackInputMonitoring }));
vi.mock('../../../repositories/audioRecorder/isTrackInputMonitored', () => ({
    isTrackInputMonitored: (trackId: string, inputId: string | null) =>
        harness.monitored.has(trackId) && harness.monitored.get(trackId) === inputId,
}));

const stores = vi.hoisted(() => ({
    trackStore: null as unknown as Store<{ tracks: TestTrack[] }>,
    transportStore: null as unknown as Store<TestTransport>,
}));

vi.mock('#/modules/Arrangement/stores', async () => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.trackStore = create<{ tracks: TestTrack[] }>();
    return {
        trackStore: stores.trackStore,
        getTrackEligibility: (kind: string) => ({ acceptsMonitoring: kind === 'audio' }),
    };
});

vi.mock('#/modules/Transport/stores', async () => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.transportStore = create<TestTransport>();
    return {
        transportStore: stores.transportStore,
        defaultTransportState: { isPlaying: false, isRecording: false },
    };
});

function audioTrack(overrides: Partial<TestTrack> = {}): TestTrack {
    return { id: 'track-1', kind: 'audio', armed: true, inputMonitoring: 'auto', inputId: 'input-1', ...overrides };
}

function setTracks(...tracks: TestTrack[]): void {
    stores.trackStore.set({ tracks });
}

function setTransport(state: TestTransport): void {
    stores.transportStore.set(state);
}

describe('syncAutoInputMonitoring', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        harness.monitored.clear();
        harness.startInputMonitoring.mockReset();
        harness.stopTrackInputMonitoring.mockReset();
        harness.startInputMonitoring.mockImplementation((trackId: string, inputId: string | null) => {
            harness.monitored.set(trackId, inputId);
            return Promise.resolve(true);
        });
        harness.stopTrackInputMonitoring.mockImplementation((trackId: string) => {
            harness.monitored.delete(trackId);
        });
        setTracks();
        setTransport({ isPlaying: false, isRecording: false });
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        unsubscribe();
    });

    it('opens the edge for an armed Auto track while the transport is stopped', () => {
        setTracks(audioTrack());

        expect(harness.startInputMonitoring).toHaveBeenCalledWith('track-1', 'input-1');
        expect(harness.monitored.has('track-1')).toBe(true);
    });

    it('closes the edge when an armed Auto track is disarmed', () => {
        setTracks(audioTrack());

        setTracks(audioTrack({ armed: false }));

        expect(harness.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
        expect(harness.monitored.has('track-1')).toBe(false);
    });

    it('keeps no edge for a disarmed Auto track', () => {
        setTracks(audioTrack({ armed: false }));

        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
        expect(harness.monitored.has('track-1')).toBe(false);
    });

    it('closes the edge for playback without recording', () => {
        setTracks(audioTrack());

        setTransport({ isPlaying: true, isRecording: false });

        expect(harness.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
        expect(harness.monitored.has('track-1')).toBe(false);
    });

    it('closes the edge when recording stops while playback continues', () => {
        setTracks(audioTrack());
        setTransport({ isPlaying: true, isRecording: true });
        expect(harness.monitored.has('track-1')).toBe(true);

        setTransport({ isPlaying: true, isRecording: false });

        expect(harness.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
        expect(harness.monitored.has('track-1')).toBe(false);
    });

    it('reopens the edge when the transport stops after a recorded take', () => {
        setTracks(audioTrack());
        setTransport({ isPlaying: true, isRecording: true });
        setTransport({ isPlaying: true, isRecording: false });
        expect(harness.monitored.has('track-1')).toBe(false);

        setTransport({ isPlaying: false, isRecording: false });

        expect(harness.monitored.has('track-1')).toBe(true);
    });

    it('opens the edge for record-while-rolling the moment recording engages', () => {
        setTracks(audioTrack());
        setTransport({ isPlaying: true, isRecording: false });
        expect(harness.monitored.has('track-1')).toBe(false);

        setTransport({ isPlaying: true, isRecording: true });

        expect(harness.monitored.has('track-1')).toBe(true);
    });

    it('follows a monitoring mode change from On back to Auto while disarmed', () => {
        setTracks(audioTrack({ inputMonitoring: 'on', armed: false }));
        harness.monitored.set('track-1', 'input-1');
        harness.stopTrackInputMonitoring.mockClear();

        setTracks(audioTrack({ inputMonitoring: 'auto', armed: false }));

        expect(harness.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
        expect(harness.monitored.has('track-1')).toBe(false);
    });

    it('never touches an On track', () => {
        setTracks(audioTrack({ inputMonitoring: 'on' }));
        harness.monitored.set('track-1', 'input-1');

        setTransport({ isPlaying: true, isRecording: false });
        setTracks(audioTrack({ inputMonitoring: 'on', armed: false }));

        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
        expect(harness.stopTrackInputMonitoring).not.toHaveBeenCalled();
        expect(harness.monitored.has('track-1')).toBe(true);
    });

    it('never touches an Off track', () => {
        setTracks(audioTrack({ inputMonitoring: 'off' }));

        setTransport({ isPlaying: false, isRecording: true });

        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
        expect(harness.stopTrackInputMonitoring).not.toHaveBeenCalled();
    });

    it('does not monitor a track whose kind refuses monitoring', () => {
        setTracks(audioTrack({ kind: 'midi' }));

        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('does not reopen an edge that is already open', () => {
        setTracks(audioTrack());
        harness.startInputMonitoring.mockClear();

        setTracks(audioTrack());
        setTransport({ isPlaying: false, isRecording: false });

        expect(harness.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('does not retry a refused open until the edge has been closed in between', async () => {
        harness.startInputMonitoring.mockImplementation(() => Promise.resolve(false));
        setTracks(audioTrack());
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.startInputMonitoring).toHaveBeenCalledTimes(1);

        setTransport({ isPlaying: false, isRecording: false });
        setTracks(audioTrack());
        expect(harness.startInputMonitoring).toHaveBeenCalledTimes(1);

        setTransport({ isPlaying: true, isRecording: false });
        setTransport({ isPlaying: false, isRecording: false });
        expect(harness.startInputMonitoring).toHaveBeenCalledTimes(2);
    });

    it('closes the edge of an Auto track removed from the project', () => {
        setTracks(audioTrack());

        setTracks();

        expect(harness.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
        expect(harness.monitored.has('track-1')).toBe(false);
    });

    it('re-establishes an edge a graph reset released when reconciled again', () => {
        setTracks(audioTrack());
        harness.monitored.clear();
        harness.startInputMonitoring.mockClear();

        reconcileAutoInputMonitoring();

        expect(harness.startInputMonitoring).toHaveBeenCalledWith('track-1', 'input-1');
    });

    it('stops reacting once unsubscribed', () => {
        setTracks(audioTrack());
        unsubscribe();
        harness.stopTrackInputMonitoring.mockClear();

        setTransport({ isPlaying: true, isRecording: false });

        expect(harness.stopTrackInputMonitoring).not.toHaveBeenCalled();
        unsubscribe = syncAutoInputMonitoring();
    });
});
