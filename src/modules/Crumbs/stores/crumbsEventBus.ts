import { type CrumbsModeChangedPayload } from '../events/CrumbsModeChangedPayload';

type CrumbsEvents = {
    'crumbs.modeChanged': CrumbsModeChangedPayload;
};

type CrumbsEventEmitter = {
    emit<TEventName extends keyof CrumbsEvents>(event: TEventName, payload: CrumbsEvents[TEventName]): Promise<void>;
};

/**
 * The outbound signal seam for the mode a Crumbs instance now runs.
 *
 * The strip push this signal stands in for cannot stay behind this module's
 * barrel: AudioEngine imports that barrel (`markAttachedCrumbsInstances`), so
 * a barrel-reachable path to the strip traversal closes a `no-circular` cycle
 * through Arrangement, CrdtDocument, Yeast and MIDI. The emitter is therefore
 * injected — `setCrumbsEventBus` at the composition root — and the traversal
 * lives in the app seam that subscribes.
 *
 * Unset means silent, deliberately: before the composition root wires it, the
 * only Crumbs writes are panel gestures on a device with no strip yet, which
 * is the same silence `resolveCrumbsPadControls` already returns.
 */
let crumbsEventBus: CrumbsEventEmitter | null = null;

export function setCrumbsEventBus(event_bus: CrumbsEventEmitter): void {
    crumbsEventBus = event_bus;
}

export function emitCrumbsModeChanged(payload: CrumbsModeChangedPayload): void {
    if (!crumbsEventBus) {
        return;
    }
    void crumbsEventBus.emit('crumbs.modeChanged', payload);
}
