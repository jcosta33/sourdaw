import type { YeastPreviewEvent, YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

export function createPreviewEvent(overrides: Partial<YeastPreviewEvent> = {}): YeastPreviewEvent {
    return {
        eventId: 1,
        rackId: 'rack-1',
        routeId: 'track-1',
        trackId: 'track-1',
        projectionVersion: 1,
        phase: 'open',
        beatTime: 1,
        durationBeats: 0.25,
        pitch: 60,
        velocity: 0.5,
        probability: 1,
        realized: true,
        processorId: 'arp-1',
        bypassed: false,
        failed: false,
        ...overrides,
    };
}

export function createPreviewSnapshot(
    events: readonly YeastPreviewEvent[],
    overrides: Partial<YeastPreviewSnapshot> = {}
): YeastPreviewSnapshot {
    return {
        rackId: 'rack-1',
        routeId: 'track-1',
        trackId: 'track-1',
        captureEpoch: 1,
        projectionVersion: 1,
        reset: false,
        capacity: 512,
        events,
        provenance: [],
        droppedEvents: 0,
        ...overrides,
    };
}
