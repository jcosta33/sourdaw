/**
 * Sample player store — owns runtime state for SFZ/SF2 instruments.
 */
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type SFZInstrument } from '#/modules/AudioEngine/models/SamplePlayerTypes';

export type { SampleRegion, SFZInstrument } from '#/modules/AudioEngine/models/SamplePlayerTypes';

type InstrumentState = {
    instruments: Record<string, SFZInstrument>;
};

const logger = Container.getInstance().get(Logger);

export const instrumentStore = new Store<InstrumentState>(logger, {
    initialData: { instruments: {} },
});

/**
 * Helper to get an instrument by ID from the store.
 */
export function getInstrument(id: string): SFZInstrument | undefined {
    return instrumentStore.value?.instruments[id];
}

/**
 * Helper to set an instrument in the store (immutable update).
 */
export function setInstrument(instrument: SFZInstrument): void {
    const current = instrumentStore.value;
    if (!current) {
        return;
    }
    instrumentStore.set({
        instruments: { ...current.instruments, [instrument.id]: instrument },
    });
}

/**
 * Helper to remove an instrument from the store.
 */
export function removeInstrument(id: string): void {
    const current = instrumentStore.value;
    if (!current) {
        return;
    }
    const { [id]: _, ...rest } = current.instruments;
    instrumentStore.set({ instruments: rest });
}
