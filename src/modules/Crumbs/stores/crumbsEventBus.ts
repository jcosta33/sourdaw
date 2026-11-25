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
 * injected — `setCrumbsEventBus` from `wireModuleEventBuses()` in
 * `src/app/bootstrap.ts` — and the traversal lives in the app seam that
 * subscribes. Emitting before it is filled throws: a mode change that was not
 * pushed would leave the strip running the previous mode.
 */
let crumbsEventBus: CrumbsEventEmitter | null = null;

export function setCrumbsEventBus(event_bus: CrumbsEventEmitter): void {
    crumbsEventBus = event_bus;
}

export function emitCrumbsModeChanged(payload: CrumbsModeChangedPayload): void {
    if (!crumbsEventBus) {
        throw new Error(
            'emitCrumbsModeChanged: no Crumbs event bus is registered; call setCrumbsEventBus() from wireModuleEventBuses() in src/app/bootstrap.ts'
        );
    }
    void crumbsEventBus.emit('crumbs.modeChanged', payload);
}
