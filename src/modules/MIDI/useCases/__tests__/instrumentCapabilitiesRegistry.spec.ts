import { beforeEach, describe, expect, it } from 'vitest';

import { getInstrumentCapabilities } from '../getInstrumentCapabilities';
import { instrumentCapabilitiesState } from '../instrumentCapabilitiesState';
import { registerInstrumentCapabilities } from '../registerInstrumentCapabilities';

type RegistrationInput = Parameters<typeof registerInstrumentCapabilities>[0];

function createDescriptor(): RegistrationInput {
    return {
        schemaVersion: 1,
        instrumentId: 'test-instrument',
        semanticsRevision: 1,
        expressionLanes: [
            {
                laneId: 'pitch',
                support: 'supported',
                scope: 'note',
            },
            {
                laneId: 'pressure',
                support: 'unavailable',
                reasonCode: 'instrument.unsupported',
            },
            {
                laneId: 'timbre',
                support: 'supported',
                scope: 'note',
            },
        ],
        tuningModel: 'per-note-pitch',
        channelModel: 'mpe',
        mpe: {
            zone: 'lower',
            memberChannels: 15,
            maxVoices: 15,
        },
        articulationSwitching: 'key-switch',
        drumMap: 'instrument-defined',
        expressionTier: 'mpe',
    };
}

function cloneDescriptor(): unknown {
    return structuredClone(createDescriptor());
}

function requireObject(value: unknown): object {
    if (value === null || typeof value !== 'object') {
        throw new Error('Expected an object');
    }
    return value;
}

function readProperty(value: unknown, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(requireObject(value), key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`Expected data property ${key}`);
    }
    return descriptor.value;
}

function setProperty(value: unknown, key: PropertyKey, propertyValue: unknown): void {
    Object.defineProperty(requireObject(value), key, {
        configurable: true,
        enumerable: true,
        value: propertyValue,
        writable: true,
    });
}

function registerUnknown(value: unknown): void {
    Reflect.apply(registerInstrumentCapabilities, undefined, [value]);
}

describe('registerInstrumentCapabilities', () => {
    beforeEach(() => {
        instrumentCapabilitiesState.resetForTests();
    });

    it('registers a normalized descriptor under its canonical instrument identifier', () => {
        registerInstrumentCapabilities(createDescriptor());

        const stored = instrumentCapabilitiesState.read('test-instrument');
        expect(stored).toMatchObject({
            schemaVersion: 1,
            trusted: true,
            descriptor: {
                availability: 'registered',
                instrumentId: 'test-instrument',
                semanticsRevision: 1,
            },
        });
        expect(getInstrumentCapabilities('test-instrument').expressionLanes).toHaveLength(3);
    });

    it('detaches and deeply freezes accepted input', () => {
        const lanes = [
            { laneId: 'pitch', support: 'unavailable', reasonCode: 'instrument.unsupported' },
            { laneId: 'pressure', support: 'unavailable', reasonCode: 'instrument.unsupported' },
            { laneId: 'timbre', support: 'unavailable', reasonCode: 'instrument.unsupported' },
        ] as const;
        const mpe = { zone: 'none' as const, memberChannels: 0, maxVoices: 0 };
        const descriptor = {
            schemaVersion: 1 as const,
            instrumentId: 'detached-instrument',
            semanticsRevision: 2,
            expressionLanes: [...lanes],
            tuningModel: 'fixed-equal-temperament' as const,
            channelModel: 'single-channel' as const,
            mpe,
            articulationSwitching: 'none' as const,
            drumMap: 'none' as const,
            expressionTier: 'none' as const,
        };

        registerInstrumentCapabilities(descriptor);
        descriptor.expressionLanes.pop();
        mpe.maxVoices = 1;

        const projection = getInstrumentCapabilities('detached-instrument');
        expect(projection.expressionLanes).toHaveLength(3);
        expect(projection.mpe.maxVoices).toBe(0);
        expect(Object.isFrozen(projection)).toBe(true);
        expect(Object.isFrozen(projection.expressionLanes)).toBe(true);
        expect(Object.isFrozen(projection.expressionLanes[0])).toBe(true);
        expect(Object.isFrozen(projection.mpe)).toBe(true);
    });

    it('rejects duplicate identifiers without replacing the first descriptor', () => {
        registerInstrumentCapabilities(createDescriptor());
        const duplicate = cloneDescriptor();
        setProperty(duplicate, 'semanticsRevision', 2);

        expect(() => registerUnknown(duplicate)).toThrow('Instrument capabilities already registered: test-instrument');
        expect(getInstrumentCapabilities('test-instrument').semanticsRevision).toBe(1);
    });

    it.each([
        {
            name: 'unknown root keys',
            mutate(value: unknown) {
                setProperty(value, 'unexpected', true);
            },
        },
        {
            name: 'unknown nested keys',
            mutate(value: unknown) {
                setProperty(readProperty(value, 'mpe'), 'unexpected', true);
            },
        },
        {
            name: 'unknown vocabulary values',
            mutate(value: unknown) {
                setProperty(value, 'tuningModel', 'adaptive');
            },
        },
        {
            name: 'duplicate expression lanes',
            mutate(value: unknown) {
                const lanes = readProperty(value, 'expressionLanes');
                const thirdLane = readProperty(lanes, '2');
                setProperty(thirdLane, 'laneId', 'pitch');
            },
        },
        {
            name: 'missing expression lane declarations',
            mutate(value: unknown) {
                setProperty(value, 'expressionLanes', [readProperty(readProperty(value, 'expressionLanes'), '0')]);
            },
        },
        {
            name: 'non-machine-readable reason codes',
            mutate(value: unknown) {
                const lanes = readProperty(value, 'expressionLanes');
                const unavailableLane = readProperty(lanes, '1');
                setProperty(unavailableLane, 'reasonCode', 'Not supported');
            },
        },
        {
            name: 'out-of-range MPE channel limits',
            mutate(value: unknown) {
                setProperty(readProperty(value, 'mpe'), 'memberChannels', 16);
            },
        },
        {
            name: 'contradictory non-MPE channel models',
            mutate(value: unknown) {
                setProperty(value, 'channelModel', 'single-channel');
            },
        },
        {
            name: 'accessor-backed properties',
            mutate(value: unknown) {
                Object.defineProperty(requireObject(value), 'instrumentId', {
                    configurable: true,
                    enumerable: true,
                    get: () => 'accessor-instrument',
                });
            },
        },
        {
            name: 'symbol properties',
            mutate(value: unknown) {
                setProperty(value, Symbol('hidden'), true);
            },
        },
        {
            name: 'sparse arrays',
            mutate(value: unknown) {
                const lanes = readProperty(value, 'expressionLanes');
                Reflect.deleteProperty(requireObject(lanes), '1');
            },
        },
        {
            name: 'class instances',
            mutate(value: unknown) {
                class Descriptor {}
                Object.setPrototypeOf(requireObject(value), Descriptor.prototype);
            },
        },
    ])('rejects $name before registry mutation', ({ mutate }) => {
        const malformed = cloneDescriptor();
        mutate(malformed);

        expect(() => registerUnknown(malformed)).toThrow('Invalid instrument capabilities descriptor');
        expect(instrumentCapabilitiesState.read('test-instrument')).toBeUndefined();
    });
});
