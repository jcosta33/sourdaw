import { beforeEach, describe, expect, it, vi } from 'vitest';

type BusModule = typeof import('../crumbsEventBus');

const payload = { deviceId: 'crumbs-1', mode: 'slicer' } as const;

describe('crumbsEventBus', () => {
    let emitCrumbsModeChanged: BusModule['emitCrumbsModeChanged'];
    let setCrumbsEventBus: BusModule['setCrumbsEventBus'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled bus; the shared spec fixture only fills the first one.
        vi.resetModules();
        const module = await import('../crumbsEventBus');
        emitCrumbsModeChanged = module.emitCrumbsModeChanged;
        setCrumbsEventBus = module.setCrumbsEventBus;
    });

    it('throws naming the bus, the fill and its registrar while none is registered', () => {
        expect(() => emitCrumbsModeChanged(payload)).toThrow(
            'emitCrumbsModeChanged: no Crumbs event bus is registered'
        );
        expect(() => emitCrumbsModeChanged(payload)).toThrow(
            'setCrumbsEventBus() from wireModuleEventBuses() in src/app/bootstrap.ts'
        );
    });

    it('emits the mode change on the registered bus', () => {
        const emit = vi.fn(() => Promise.resolve());
        setCrumbsEventBus({ emit });

        emitCrumbsModeChanged(payload);

        expect(emit).toHaveBeenCalledExactlyOnceWith('crumbs.modeChanged', payload);
    });

    it('a second fill replaces the first', () => {
        const first = vi.fn(() => Promise.resolve());
        const second = vi.fn(() => Promise.resolve());
        setCrumbsEventBus({ emit: first });
        setCrumbsEventBus({ emit: second });

        emitCrumbsModeChanged(payload);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
