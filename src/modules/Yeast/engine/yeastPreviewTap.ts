import { YEAST_PREVIEW_CAPACITY } from '../models/YeastPreviewSnapshot';

import type {
    YeastPreviewBlock,
    YeastPreviewEvent,
    YeastPreviewProcessorProvenance,
    YeastPreviewSnapshot,
} from '../models/YeastPreviewSnapshot';

export { YEAST_PREVIEW_CAPACITY } from '../models/YeastPreviewSnapshot';

type MutableYeastPreviewEvent = {
    -readonly [Key in keyof YeastPreviewEvent]: YeastPreviewEvent[Key];
};

type YeastPreviewScope = Readonly<{
    rackId: string;
    routeId: string;
    trackId: string;
}>;

type RouteBuffer = {
    readonly storage: MutableYeastPreviewEvent[];
    readIndex: number;
    size: number;
    droppedEvents: number;
    projectionVersion: number;
    reset: boolean;
    provenance: readonly YeastPreviewProcessorProvenance[];
};

function createPreviewSlot(): MutableYeastPreviewEvent {
    return {
        eventId: 0,
        rackId: '',
        routeId: '',
        trackId: '',
        projectionVersion: 0,
        phase: 'open',
        beatTime: 0,
        durationBeats: 0,
        pitch: 0,
        velocity: 0,
        probability: null,
        realized: true,
        processorId: null,
        bypassed: false,
        failed: false,
    };
}

function createRouteBuffer(): RouteBuffer {
    return {
        storage: Array.from({ length: YEAST_PREVIEW_CAPACITY }, createPreviewSlot),
        readIndex: 0,
        size: 0,
        droppedEvents: 0,
        projectionVersion: 0,
        reset: false,
        provenance: [],
    };
}

function copyEvent(target: MutableYeastPreviewEvent, source: YeastPreviewEvent): void {
    target.eventId = source.eventId;
    target.rackId = source.rackId;
    target.routeId = source.routeId;
    target.trackId = source.trackId;
    target.projectionVersion = source.projectionVersion;
    target.phase = source.phase;
    target.beatTime = source.beatTime;
    target.durationBeats = source.durationBeats;
    target.pitch = source.pitch;
    target.velocity = source.velocity;
    target.probability = source.probability;
    target.realized = source.realized;
    target.processorId = source.processorId;
    target.bypassed = source.bypassed;
    target.failed = source.failed;
}

export class YeastPreviewTap {
    private readonly routes = new Map<string, Map<string, RouteBuffer>>();

    setEnabled(scope: YeastPreviewScope, enabled: boolean): void {
        const rackRoutes = this.routes.get(scope.rackId);
        if (!enabled) {
            rackRoutes?.delete(scope.routeId);
            if (rackRoutes?.size === 0) {
                this.routes.delete(scope.rackId);
            }
            return;
        }
        if (rackRoutes?.has(scope.routeId)) {
            return;
        }
        const nextRackRoutes = rackRoutes ?? new Map<string, RouteBuffer>();
        nextRackRoutes.set(scope.routeId, createRouteBuffer());
        this.routes.set(scope.rackId, nextRackRoutes);
    }

    isEnabled(scope: Pick<YeastPreviewScope, 'rackId' | 'routeId'>): boolean {
        return this.routes.get(scope.rackId)?.has(scope.routeId) ?? false;
    }

    publish(input: YeastPreviewBlock): void {
        const route = this.routes.get(input.rackId)?.get(input.routeId);
        if (!route) {
            return;
        }

        if (input.reset) {
            route.readIndex = 0;
            route.size = 0;
            route.droppedEvents = 0;
            route.reset = true;
        }
        route.projectionVersion = input.projectionVersion;
        route.provenance = input.provenance;
        route.droppedEvents = Math.min(Number.MAX_SAFE_INTEGER, route.droppedEvents + input.droppedEvents);
        for (let index = 0; index < input.records.length; index++) {
            const record = input.records[index]!;
            const recordRoute = this.routes.get(record.rackId)?.get(record.routeId);
            if (!recordRoute) {
                continue;
            }
            recordRoute.projectionVersion = record.projectionVersion;
            if (recordRoute.size === YEAST_PREVIEW_CAPACITY) {
                recordRoute.droppedEvents = Math.min(Number.MAX_SAFE_INTEGER, recordRoute.droppedEvents + 1);
                continue;
            }
            const slot = recordRoute.storage[(recordRoute.readIndex + recordRoute.size) % YEAST_PREVIEW_CAPACITY]!;
            copyEvent(slot, record);
            recordRoute.size += 1;
        }
    }

    read(scope: YeastPreviewScope): YeastPreviewSnapshot {
        const route = this.routes.get(scope.rackId)?.get(scope.routeId);
        const events: YeastPreviewEvent[] = [];
        if (route) {
            for (let index = 0; index < route.size; index++) {
                const slot = route.storage[(route.readIndex + index) % YEAST_PREVIEW_CAPACITY]!;
                events.push(Object.freeze({ ...slot }));
            }
        }

        const snapshot = Object.freeze({
            rackId: scope.rackId,
            routeId: scope.routeId,
            trackId: scope.trackId,
            projectionVersion: route?.projectionVersion ?? 0,
            reset: route?.reset ?? false,
            capacity: YEAST_PREVIEW_CAPACITY,
            events: Object.freeze(events),
            provenance: Object.freeze([...(route?.provenance ?? [])]),
            droppedEvents: route?.droppedEvents ?? 0,
        });
        if (route) {
            route.readIndex = (route.readIndex + route.size) % YEAST_PREVIEW_CAPACITY;
            route.size = 0;
            route.droppedEvents = 0;
            route.reset = false;
        }
        return snapshot;
    }

    getStorageIdentity(scope: Pick<YeastPreviewScope, 'rackId' | 'routeId'>): object | undefined {
        return this.routes.get(scope.rackId)?.get(scope.routeId)?.storage;
    }
}

export const yeastPreviewTap = new YeastPreviewTap();
