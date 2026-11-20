import type { BuiltinDeviceNode, ToasterDeviceControls, TrackChannelStrip } from '../../models/AudioEngineState';

export type ToasterPadBinding = Readonly<{
    toasterParentTrackId: string;
    padIndex: number;
}>;

export type ToasterPadRoute = ToasterPadBinding & {
    destinationNode: GainNode | null;
    controls: ToasterDeviceControls | null;
};

export type ToasterPadRouteSnapshot = Readonly<{
    toasterParentTrackId: string;
    padIndex: number;
    destinationNode: GainNode | null;
    controls: ToasterDeviceControls | null;
    dryRouted: boolean;
}>;

type ToasterPadOutputControls = ToasterDeviceControls & {
    connectPadOutput: NonNullable<ToasterDeviceControls['connectPadOutput']>;
};

type PadOutputTarget = Readonly<{ controls: ToasterDeviceControls; padIndex: number; destinationNode: GainNode }>;

export type ToasterPadRouting = {
    /** The live pad routes, keyed by the source track whose strip a pad feeds. */
    readonly routes: Map<string, ToasterPadRoute>;
    snapshotRoute(trackId: string): ToasterPadRouteSnapshot | undefined;
    /**
     * Rolls a failed binding change back to its snapshot: clears every pad output
     * the current or attempted binding may have connected, restores the route
     * state, then re-attaches the snapshot's dry route.
     */
    restoreBinding(
        trackId: string,
        sourceDestinationNode: GainNode,
        snapshot: ToasterPadRouteSnapshot | undefined,
        attemptedBinding: ToasterPadBinding | undefined
    ): void;
    /** Applies a track's pad binding and reports whether the binding itself changed. */
    updateBinding(trackId: string, padBinding: ToasterPadBinding | undefined): boolean;
    reconcileParent(toasterParentTrackId: string): void;
    handleDeviceRemoved(trackId: string, device: BuiltinDeviceNode): void;
    /** Forgets the removed strip's own route and every route its Toaster owned. */
    forgetRoutesOfRemovedStrip(trackId: string): void;
    hasLiveRoute(): boolean;
    /** The graph reset's pad-output teardown effects for every route live when called. */
    resetEffects(): Array<() => void>;
    clear(): void;
};

export type ToasterPadRoutingPorts = Readonly<{
    /** The live strip of a track, read per call. */
    readTrackStrip: (trackId: string) => TrackChannelStrip | undefined;
}>;

function hasToasterPadOutputControls(
    controls: ToasterDeviceControls | undefined | null
): controls is ToasterPadOutputControls {
    return typeof controls?.connectPadOutput === 'function';
}

function isValidToasterPadBinding(padBinding: ToasterPadBinding | undefined): padBinding is ToasterPadBinding {
    return (
        padBinding !== undefined &&
        Number.isInteger(padBinding.padIndex) &&
        padBinding.padIndex >= 0 &&
        padBinding.padIndex < 16
    );
}

function clearToasterPadOutput(controls: ToasterDeviceControls, padIndex: number, destinationNode: GainNode): void {
    try {
        controls.disconnectPadOutput?.(padIndex, destinationNode);
    } finally {
        controls.setPadDryRouted(padIndex, false);
    }
}

function addPadOutputTarget(targets: PadOutputTarget[], target: PadOutputTarget): void {
    const known = targets.some(
        (candidate) =>
            candidate.controls === target.controls &&
            candidate.padIndex === target.padIndex &&
            candidate.destinationNode === target.destinationNode
    );
    if (!known) {
        targets.push(target);
    }
}

function clearPadOutputTargets(targets: readonly PadOutputTarget[]): unknown[] {
    const clearErrors: unknown[] = [];
    for (const target of targets) {
        try {
            clearToasterPadOutput(target.controls, target.padIndex, target.destinationNode);
        } catch (error) {
            clearErrors.push(error);
        }
    }
    return clearErrors;
}

function reattachSnapshotDryRoute(snapshot: ToasterPadRouteSnapshot | undefined): void {
    if (!snapshot?.dryRouted || !snapshot.controls || !snapshot.destinationNode) {
        return;
    }
    const controls = snapshot.controls;
    if (!hasToasterPadOutputControls(controls)) {
        throw new Error('Toaster pad route snapshot has no connect output control');
    }
    controls.connectPadOutput(snapshot.padIndex, snapshot.destinationNode);
    controls.setPadDryRouted(snapshot.padIndex, true);
}

type ReadTrackStrip = ToasterPadRoutingPorts['readTrackStrip'];
type RouteMap = Map<string, ToasterPadRoute>;
type RoutingState = Readonly<{ routes: RouteMap; readTrackStrip: ReadTrackStrip }>;

function getToasterPadControls(
    readTrackStrip: ReadTrackStrip,
    toasterParentTrackId: string
): ToasterPadOutputControls | undefined {
    const controls = readTrackStrip(toasterParentTrackId)?.deviceNodes.find(
        (candidate) => candidate.toasterControls?.connectPadOutput
    )?.toasterControls;
    return hasToasterPadOutputControls(controls) ? controls : undefined;
}

function snapshotRoute(routes: RouteMap, trackId: string): ToasterPadRouteSnapshot | undefined {
    const route = routes.get(trackId);
    if (!route) {
        return undefined;
    }
    return Object.freeze({
        toasterParentTrackId: route.toasterParentTrackId,
        padIndex: route.padIndex,
        destinationNode: route.destinationNode,
        controls: route.controls,
        dryRouted: route.destinationNode !== null && route.controls !== null,
    });
}

function restoreRouteState(routes: RouteMap, trackId: string, snapshot: ToasterPadRouteSnapshot | undefined): void {
    if (!snapshot) {
        routes.delete(trackId);
        return;
    }
    routes.set(trackId, {
        toasterParentTrackId: snapshot.toasterParentTrackId,
        padIndex: snapshot.padIndex,
        destinationNode: snapshot.destinationNode,
        controls: snapshot.controls,
    });
}

function restoreBinding(
    state: RoutingState,
    trackId: string,
    sourceDestinationNode: GainNode,
    snapshot: ToasterPadRouteSnapshot | undefined,
    attemptedBinding: ToasterPadBinding | undefined
): void {
    const { routes, readTrackStrip } = state;
    const targets: PadOutputTarget[] = [];
    const current = routes.get(trackId);
    if (current?.controls && current.destinationNode) {
        addPadOutputTarget(targets, {
            controls: current.controls,
            padIndex: current.padIndex,
            destinationNode: current.destinationNode,
        });
    }
    if (isValidToasterPadBinding(attemptedBinding)) {
        const attemptedControls = getToasterPadControls(readTrackStrip, attemptedBinding.toasterParentTrackId);
        if (attemptedControls) {
            addPadOutputTarget(targets, {
                controls: attemptedControls,
                padIndex: attemptedBinding.padIndex,
                destinationNode: sourceDestinationNode,
            });
        }
    }

    const clearErrors = clearPadOutputTargets(targets);
    restoreRouteState(routes, trackId, snapshot);
    if (clearErrors.length === 1) {
        throw clearErrors[0];
    }
    if (clearErrors.length > 1) {
        throw new AggregateError(clearErrors, 'Toaster pad route cleanup failed during transaction restoration');
    }
    reattachSnapshotDryRoute(snapshot);
}

function detachRoute(routes: RouteMap, trackId: string, forgetRoute: boolean): boolean {
    const route = routes.get(trackId);
    if (!route) {
        return false;
    }
    if (route.destinationNode) {
        try {
            route.controls?.disconnectPadOutput?.(route.padIndex, route.destinationNode);
        } finally {
            route.controls?.setPadDryRouted(route.padIndex, false);
        }
    }
    route.destinationNode = null;
    route.controls = null;
    if (forgetRoute) {
        routes.delete(trackId);
    }
    return true;
}

function reconcileParent(state: RoutingState, toasterParentTrackId: string): void {
    const { routes, readTrackStrip } = state;
    const controls = getToasterPadControls(readTrackStrip, toasterParentTrackId);
    if (!controls) {
        return;
    }
    for (const [trackId, route] of routes) {
        if (route.toasterParentTrackId !== toasterParentTrackId || route.controls === controls) {
            continue;
        }
        if (route.destinationNode) {
            detachRoute(routes, trackId, false);
        }
        const destinationNode = readTrackStrip(trackId)?.gainNode;
        if (!destinationNode) {
            continue;
        }
        controls.connectPadOutput(route.padIndex, destinationNode);
        controls.setPadDryRouted(route.padIndex, true);
        route.destinationNode = destinationNode;
        route.controls = controls;
    }
}

function handleDeviceRemoved(state: RoutingState, trackId: string, device: BuiltinDeviceNode): void {
    const { routes } = state;
    if (device.type !== 'toaster') {
        return;
    }
    for (const [sourceTrackId, route] of routes) {
        if (route.toasterParentTrackId !== trackId) {
            continue;
        }
        if (route.controls && route.controls !== device.toasterControls) {
            continue;
        }
        detachRoute(routes, sourceTrackId, false);
    }
    reconcileParent(state, trackId);
}

function updateBinding(state: RoutingState, trackId: string, padBinding: ToasterPadBinding | undefined): boolean {
    const { routes } = state;
    if (!isValidToasterPadBinding(padBinding)) {
        return detachRoute(routes, trackId, true);
    }
    const existing = routes.get(trackId);
    const changedOwner =
        existing &&
        (existing.toasterParentTrackId !== padBinding.toasterParentTrackId ||
            existing.padIndex !== padBinding.padIndex);
    if (changedOwner) {
        detachRoute(routes, trackId, true);
    }
    if (!routes.has(trackId)) {
        routes.set(trackId, { ...padBinding, destinationNode: null, controls: null });
        reconcileParent(state, padBinding.toasterParentTrackId);
        return true;
    }
    reconcileParent(state, padBinding.toasterParentTrackId);
    return false;
}

function forgetRoutesOfRemovedStrip(routes: RouteMap, trackId: string): void {
    detachRoute(routes, trackId, true);
    for (const [sourceTrackId, route] of routes) {
        if (route.toasterParentTrackId === trackId) {
            detachRoute(routes, sourceTrackId, true);
        }
    }
}

function resetEffects(routes: RouteMap): Array<() => void> {
    return Array.from(routes.values()).flatMap((route) => {
        const { controls, destinationNode, padIndex } = route;
        if (!destinationNode) {
            return [];
        }
        return [
            () => controls?.disconnectPadOutput?.(padIndex, destinationNode),
            () => controls?.setPadDryRouted(padIndex, false),
        ];
    });
}

export function createToasterPadRouting({ readTrackStrip }: ToasterPadRoutingPorts): ToasterPadRouting {
    const routes: RouteMap = new Map();
    const state: RoutingState = { routes, readTrackStrip };

    return {
        routes,
        snapshotRoute: (trackId) => snapshotRoute(routes, trackId),
        restoreBinding: (trackId, sourceDestinationNode, snapshot, attemptedBinding) => {
            restoreBinding(state, trackId, sourceDestinationNode, snapshot, attemptedBinding);
        },
        updateBinding: (trackId, padBinding) => updateBinding(state, trackId, padBinding),
        reconcileParent: (toasterParentTrackId) => {
            reconcileParent(state, toasterParentTrackId);
        },
        handleDeviceRemoved: (trackId, device) => {
            handleDeviceRemoved(state, trackId, device);
        },
        forgetRoutesOfRemovedStrip: (trackId) => {
            forgetRoutesOfRemovedStrip(routes, trackId);
        },
        hasLiveRoute: () => Array.from(routes.values()).some((route) => route.destinationNode !== null),
        resetEffects: () => resetEffects(routes),
        clear: () => routes.clear(),
    };
}
