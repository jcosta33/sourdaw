import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortModule = typeof import('../sessionUndoWitnessStampPort');

describe('sessionUndoWitnessStampPort', () => {
    let port: PortModule['sessionUndoWitnessStampPort'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled port; the shared spec fixture only fills the first one.
        vi.resetModules();
        port = (await import('../sessionUndoWitnessStampPort')).sessionUndoWitnessStampPort;
    });

    it('throws naming the port, the fill and its registrar while no provider is registered', () => {
        expect(() => port.stamp()).toThrow('sessionUndoWitnessStampPort.stamp: no provider is registered');
        expect(() => port.stamp()).toThrow(
            'sessionUndoWitnessStampPort.setProvider() from registerCorePorts() in src/app/bootstrap.ts'
        );
    });

    it('runs the filled provider on each stamp', () => {
        const provider = vi.fn();
        port.setProvider(provider);

        port.stamp();
        port.stamp();

        expect(provider).toHaveBeenCalledTimes(2);
    });

    it('a second fill replaces the first', () => {
        const first = vi.fn();
        const second = vi.fn();
        port.setProvider(first);
        port.setProvider(second);

        port.stamp();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
