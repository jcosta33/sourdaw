import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTrack } from '#/modules/Arrangement/useCases';
import { addDeviceToStrip, getTrackStrip } from '#/modules/AudioEngine/useCases';

import { createGrandBouleTrack } from '../createGrandBouleTrack';

import type { Track } from '#/modules/Arrangement/stores';

const mocks = vi.hoisted(() => {
    const trackStoreValue: unknown = null;
    return {
        trackStoreValue,
        appendTrack: vi.fn(),
        warn: vi.fn(),
    };
});

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
    appendTrack: mocks.appendTrack,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    createTrack: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    addDeviceToStrip: vi.fn(),
    getTrackStrip: vi.fn(),
}));

/** Build a minimal strip whose deviceNodes report the given device ids. */
function stripWithDevices(deviceIds: string[]): ReturnType<typeof getTrackStrip> {
    return { deviceNodes: deviceIds.map((deviceId) => ({ deviceId })) } as ReturnType<typeof getTrackStrip>;
}

/** Full Track fixture; field values mirror Arrangement's TrackDummy. */
function makeGbTrack(): Track {
    return {
        id: 'track-gb',
        name: 'Grand Boule',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('createGrandBouleTrack', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.appendTrack.mockReset();
        mocks.warn.mockReset();
        vi.mocked(createTrack).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
        vi.mocked(getTrackStrip).mockReset();
    });

    it('should return null when track store is not ready', () => {
        mocks.trackStoreValue = null;

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        expect(createGrandBouleTrack()).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should create track, wire device, emit track.added, and return track id', () => {
        const mockTrack = makeGbTrack();

        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
        vi.mocked(createTrack).mockReturnValue(mockTrack);
        // The strip reports the exact device id that was wired in.
        vi.mocked(addDeviceToStrip).mockImplementation((_trackId, deviceId) => {
            vi.mocked(getTrackStrip).mockReturnValue(stripWithDevices([deviceId]));
        });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        expect(id).toBe('track-gb');
        expect(mocks.appendTrack).toHaveBeenCalledWith(mockTrack);
        expect(addDeviceToStrip).toHaveBeenCalledWith(
            'track-gb',
            expect.stringMatching(/^grand-boule-/),
            'grand-boule'
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ trackId: 'track-gb', name: 'Grand Boule', kind: 'midi' })
        );
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    // Regression: prior #54/#55 — a failed strip wiring still announced a
    // fully-wired track via track.added.
    it('does not emit track.added when the device fails to wire into the strip', () => {
        const mockTrack = makeGbTrack();

        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
        vi.mocked(createTrack).mockReturnValue(mockTrack);
        // addDeviceToStrip is a no-op (fallback mode / missing strip): the
        // device never lands in deviceNodes.
        vi.mocked(getTrackStrip).mockReturnValue(stripWithDevices([]));

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        // The track is still created in the arrangement, so the id is returned.
        expect(id).toBe('track-gb');
        expect(mocks.appendTrack).toHaveBeenCalledWith(mockTrack);
        // But the false "fully wired" announcement must be suppressed.
        expect(eventBus.emit).not.toHaveBeenCalledWith('track.added', expect.anything());
        expect(mocks.warn).toHaveBeenCalledTimes(1);
    });

    it('does not emit track.added when the strip is missing entirely', () => {
        const mockTrack = makeGbTrack();

        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
        vi.mocked(createTrack).mockReturnValue(mockTrack);
        vi.mocked(getTrackStrip).mockReturnValue(undefined);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        expect(id).toBe('track-gb');
        expect(eventBus.emit).not.toHaveBeenCalledWith('track.added', expect.anything());
        expect(mocks.warn).toHaveBeenCalledTimes(1);
    });
});
