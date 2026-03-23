import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

export type SampleRegion = {
    keyLo: number;
    keyHi: number;
    velLo: number;
    velHi: number;
    sampleUrl: string;
    rootKey: number;
    loopStart?: number;
    loopEnd?: number;
    tuning: number; // cents
    volume: number; // dB
    pan: number; // -100 to 100
};

export type SFZInstrument = {
    id: string;
    name: string;
    format: 'sfz' | 'sf2';
    regions: SampleRegion[];
    globalDefaults: Partial<SampleRegion>;
    loaded: boolean;
    sampleBuffers: Map<string, AudioBuffer>;
};

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

