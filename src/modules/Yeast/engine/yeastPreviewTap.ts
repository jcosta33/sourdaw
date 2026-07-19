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

export type YeastPreviewBinding = YeastPreviewScope & Readonly<{ captureEpoch: number }>;

type RouteBuffer = {
    readonly slots: number[];
    captureEpoch: number;
    readonly trackId: string;
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

function createRouteBuffer(captureEpoch: number, trackId: string): RouteBuffer {
    return {
        slots: [],
        captureEpoch,
        trackId,
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
    /** One aggregate event pool shared by every route. No route can multiply the 512-event budget. */
    private readonly storage = Array.from({ length: YEAST_PREVIEW_CAPACITY }, createPreviewSlot);
    /** LIFO free list seeded in reverse so first allocation uses slot zero deterministically. */
    private readonly freeSlots = Array.from(
        { length: YEAST_PREVIEW_CAPACITY },
        (_, index) => YEAST_PREVIEW_CAPACITY - index - 1
    );
    private nextCaptureEpoch = 0;

    setEnabled(scope: YeastPreviewScope, enabled: boolean): YeastPreviewBinding | undefined {
        const rackRoutes = this.routes.get(scope.rackId);
        const existing = rackRoutes?.get(scope.routeId);
        if (!enabled && existing?.trackId !== scope.trackId) {
            return undefined;
        }
        if (enabled && existing?.trackId === scope.trackId) {
            return undefined;
        }
        const released = existing
            ? {
                  rackId: scope.rackId,
                  routeId: scope.routeId,
                  trackId: existing.trackId,
                  captureEpoch: existing.captureEpoch,
              }
            : undefined;
        const captureEpoch = this.takeNextCaptureEpoch();
        if (existing) {
            this.releaseRouteSlots(existing);
        }
        if (!enabled) {
            rackRoutes?.delete(scope.routeId);
            if (rackRoutes?.size === 0) {
                this.routes.delete(scope.rackId);
            }
            return released;
        }
        const nextRackRoutes = rackRoutes ?? new Map<string, RouteBuffer>();
        nextRackRoutes.set(scope.routeId, createRouteBuffer(captureEpoch, scope.trackId));
        this.routes.set(scope.rackId, nextRackRoutes);
        return released;
    }

    isEnabled(scope: YeastPreviewScope): boolean {
        return this.findRoute(scope) !== undefined;
    }

    getCaptureState(scope: YeastPreviewScope): Readonly<{
        enabled: boolean;
        captureEpoch: number;
    }> {
        const route = this.findRoute(scope);
        return route ? { enabled: true, captureEpoch: route.captureEpoch } : { enabled: false, captureEpoch: 0 };
    }

    reset(scope: YeastPreviewScope): YeastPreviewBinding | undefined {
        const route = this.findRoute(scope);
        if (!route) {
            return undefined;
        }
        const released = { ...scope, captureEpoch: route.captureEpoch };
        route.captureEpoch = this.takeNextCaptureEpoch();
        this.releaseRouteSlots(route);
        route.droppedEvents = 0;
        route.projectionVersion = 0;
        route.reset = true;
        route.provenance = [];
        return released;
    }

    resetAll(): YeastPreviewBinding[] {
        const released: YeastPreviewBinding[] = [];
        for (const [rackId, routes] of this.routes) {
            for (const [routeId, route] of routes) {
                const scope = { rackId, routeId, trackId: route.trackId };
                const binding = this.reset(scope);
                if (binding) {
                    released.push(binding);
                }
            }
        }
        return released;
    }

    publish(input: YeastPreviewBlock): void {
        const route = this.routes.get(input.rackId)?.get(input.routeId);
        if (!route || input.captureEpoch !== route.captureEpoch || input.trackId !== route.trackId) {
            return;
        }

        if (input.reset) {
            this.releaseRouteSlots(route);
            route.droppedEvents = 0;
            route.reset = true;
        }
        route.projectionVersion = input.projectionVersion;
        route.provenance = input.provenance.map((entry) => Object.freeze({ ...entry }));
        route.droppedEvents = Math.min(Number.MAX_SAFE_INTEGER, route.droppedEvents + input.droppedEvents);
        for (let index = 0; index < input.records.length; index++) {
            const record = input.records[index]!;
            const recordRoute = this.routes.get(record.rackId)?.get(record.routeId);
            if (
                !recordRoute ||
                recordRoute.captureEpoch !== input.captureEpoch ||
                record.trackId !== recordRoute.trackId
            ) {
                continue;
            }
            recordRoute.projectionVersion = record.projectionVersion;
            const slotIndex = this.freeSlots.pop();
            if (slotIndex === undefined) {
                recordRoute.droppedEvents = Math.min(Number.MAX_SAFE_INTEGER, recordRoute.droppedEvents + 1);
                continue;
            }
            const slot = this.storage[slotIndex]!;
            copyEvent(slot, record);
            recordRoute.slots.push(slotIndex);
        }
    }

    read(scope: YeastPreviewScope): YeastPreviewSnapshot {
        const route = this.findRoute(scope);
        const events: YeastPreviewEvent[] = [];
        if (route) {
            for (const slotIndex of route.slots) {
                const slot = this.storage[slotIndex]!;
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
            this.releaseRouteSlots(route);
            route.droppedEvents = 0;
            route.reset = false;
        }
        return snapshot;
    }

    getStorageIdentity(scope: YeastPreviewScope): object | undefined {
        return this.findRoute(scope)?.slots;
    }

    private releaseRouteSlots(route: RouteBuffer): void {
        for (const slotIndex of route.slots) {
            this.freeSlots.push(slotIndex);
        }
        route.slots.length = 0;
    }

    private findRoute(scope: YeastPreviewScope): RouteBuffer | undefined {
        const route = this.routes.get(scope.rackId)?.get(scope.routeId);
        return route?.trackId === scope.trackId ? route : undefined;
    }

    private takeNextCaptureEpoch(): number {
        this.nextCaptureEpoch = this.nextCaptureEpoch === Number.MAX_SAFE_INTEGER ? 1 : this.nextCaptureEpoch + 1;
        return this.nextCaptureEpoch;
    }
}

export const yeastPreviewTap = new YeastPreviewTap();
