import type { RegisteredInstrumentCapabilities } from '../models/InstrumentCapabilities';

type StoredInstrumentCapabilities = Readonly<{
    schemaVersion: number;
    trusted: boolean;
    descriptor: unknown;
}>;

const descriptors = new Map<string, StoredInstrumentCapabilities>();

export const instrumentCapabilitiesState = Object.freeze({
    read(instrumentId: string): StoredInstrumentCapabilities | undefined {
        return descriptors.get(instrumentId);
    },
    register(instrumentId: string, descriptor: RegisteredInstrumentCapabilities): boolean {
        if (descriptors.has(instrumentId)) {
            return false;
        }

        descriptors.set(
            instrumentId,
            Object.freeze({
                schemaVersion: 1,
                trusted: true,
                descriptor,
            })
        );
        return true;
    },
    resetForTests(): void {
        descriptors.clear();
    },
    seedForTests({
        instrumentId,
        schemaVersion,
        trusted,
        descriptor,
    }: Readonly<{
        instrumentId: string;
        schemaVersion: number;
        trusted: boolean;
        descriptor: unknown;
    }>): void {
        descriptors.set(
            instrumentId,
            Object.freeze({
                schemaVersion,
                trusted,
                descriptor,
            })
        );
    },
});
