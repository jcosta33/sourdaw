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
 * Emitting before the composition root wires it throws rather than going
 * silent: a dropped signal would leave the strip on the previous mode while
 * the panel and the document show the new one.
 */
let registeredCrumbsEventBus: CrumbsEventEmitter | null = null;

export function setCrumbsEventBus(event_bus: CrumbsEventEmitter): void {
    registeredCrumbsEventBus = event_bus;
}

export function emitCrumbsModeChanged(payload: CrumbsModeChangedPayload): void {
    if (registeredCrumbsEventBus === null) {
        throw new Error(
            'emitCrumbsModeChanged: the Crumbs event emitter is not registered; call setCrumbsEventBus() from #/app/bootstrap (bootstrap does this)'
        );
    }
    void registeredCrumbsEventBus.emit('crumbs.modeChanged', payload);
}
