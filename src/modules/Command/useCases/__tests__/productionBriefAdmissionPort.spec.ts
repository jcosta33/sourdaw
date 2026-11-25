import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortModule = typeof import('../productionBriefAdmissionPort');

const REGISTRAR = 'from registerCorePorts() in src/app/bootstrap.ts';

describe('productionBriefAdmissionPort', () => {
    let port: PortModule['productionBriefAdmissionPort'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled port; the shared spec fixture only fills the first one.
        vi.resetModules();
        port = (await import('../productionBriefAdmissionPort')).productionBriefAdmissionPort;
    });

    it('capture throws naming the port, the fill and its registrar while no guard is registered', () => {
        expect(() => port.capture([])).toThrow(
            'productionBriefAdmissionPort.capture: no admission guard is registered'
        );
        expect(() => port.capture([])).toThrow(`productionBriefAdmissionPort.setGuard() ${REGISTRAR}`);
    });

    it('subscribe throws naming the port, the fill and its registrar while no subscription is registered', () => {
        expect(() => port.subscribe(() => undefined)).toThrow(
            'productionBriefAdmissionPort.subscribe: no change subscription is registered'
        );
        expect(() => port.subscribe(() => undefined)).toThrow(
            `productionBriefAdmissionPort.setSubscription() ${REGISTRAR}`
        );
    });

    it('answers capture through the filled guard with the actions it was given', () => {
        const guard = vi.fn(() => ({ allowsCurrent: () => false }));
        port.setGuard(guard);

        const admission = port.capture([]);

        expect(guard).toHaveBeenCalledWith([]);
        expect(admission.allowsCurrent()).toBe(false);
    });

    it('a second guard fill replaces the first', () => {
        const first = vi.fn(() => ({ allowsCurrent: () => false }));
        const second = vi.fn(() => ({ allowsCurrent: () => true }));
        port.setGuard(first);
        port.setGuard(second);

        expect(port.capture([]).allowsCurrent()).toBe(true);
        expect(first).not.toHaveBeenCalled();
    });

    it('subscribes through the filled subscription and returns its stop function', () => {
        const stop = vi.fn();
        const subscription = vi.fn(() => stop);
        port.setSubscription(subscription);
        const listener = vi.fn();

        const returnedStop = port.subscribe(listener);

        expect(subscription).toHaveBeenCalledWith(listener);
        expect(returnedStop).toBe(stop);
    });

    it('a second subscription fill replaces the first', () => {
        const first = vi.fn(() => () => undefined);
        const second = vi.fn(() => () => undefined);
        port.setSubscription(first);
        port.setSubscription(second);

        port.subscribe(() => undefined);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
