import { initGrandBouleSubscribers, setGrandBouleEventBus } from '#/modules/GrandBoule/useCases';

type GrandBouleEventBus = Parameters<typeof setGrandBouleEventBus>[0];
type GrandBouleSubscribersInput = Parameters<typeof initGrandBouleSubscribers>[0];

export type ComposeGrandBouleInput = {
    eventBus: GrandBouleEventBus & GrandBouleSubscribersInput['eventBus'];
    logger: GrandBouleSubscribersInput['logger'];
};

/**
 * Wire Grand Boule's runtime event bus binding and its `audioDevice.loaded`
 * subscriber. Split out of `bootstrap.ts` so an edit here does not churn the
 * digest of every other module's composition wiring — see #3089.
 */
export function composeGrandBoule({ eventBus, logger }: ComposeGrandBouleInput): void {
    setGrandBouleEventBus(eventBus);
    initGrandBouleSubscribers({ eventBus, logger });
}
