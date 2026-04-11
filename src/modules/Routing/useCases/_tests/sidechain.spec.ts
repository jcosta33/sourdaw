import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { addSidechainRoute } from '../sidechain/addSidechainRoute';
import { removeSidechainRoute } from '../sidechain/removeSidechainRoute';
import { setSidechainRoutes } from '../sidechain/setSidechainRoutes';
import { getSidechainRoutesForTrack } from '../sidechain/getSidechainRoutesForTrack';
import { getSidechainSource } from '../sidechain/getSidechainSource';
import { getAllSidechainRoutes } from '../sidechain/getAllSidechainRoutes';
import { SidechainCycleError } from '../../errors/RoutingErrors';

function makeStore(initial: { routes: { id: string; sourceTrackId: string; targetTrackId: string; targetDeviceId: string; targetParameterId: string }[] } | null) {
    let value = initial;
    return {
        get value() {
            return value;
        },
        set: vi.fn((next: typeof value) => {
            value = next;
        }),
    };
}

describe('sidechain use cases', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('addSidechainRoute creates and wires a new route', () => {
        const store = makeStore({ routes: [] });
        const wireSidechainRoute = vi.fn();
        const unwireSidechainRoute = vi.fn();
        const createSidechainRoute = vi.fn(
            (sourceTrackId: string, targetTrackId: string, targetDeviceId: string, targetParameterId: string) => ({
                id: 'r1',
                sourceTrackId,
                targetTrackId,
                targetDeviceId,
                targetParameterId,
            })
        );
        injectDependencies(addSidechainRoute, {
            createSidechainRoute,
            wireSidechainRoute,
            unwireSidechainRoute,
            sidechainStore: store as never,
        });

        addSidechainRoute('src', 'dst', 'dev1');

        expect(createSidechainRoute).toHaveBeenCalledWith('src', 'dst', 'dev1', 'threshold');
        expect(store.set).toHaveBeenCalled();
        expect(wireSidechainRoute).toHaveBeenCalledWith('src', 'dst', 'dev1');
    });

    it('addSidechainRoute throws on self-routing cycle', () => {
        const store = makeStore({ routes: [] });
        injectDependencies(addSidechainRoute, {
            createSidechainRoute: vi.fn(),
            wireSidechainRoute: vi.fn(),
            unwireSidechainRoute: vi.fn(),
            sidechainStore: store as never,
        });

        expect(() => addSidechainRoute('t1', 't1', 'dev1')).toThrow(SidechainCycleError);
    });

    it('addSidechainRoute is idempotent for duplicates', () => {
        const existing = {
            id: 'r1',
            sourceTrackId: 'src',
            targetTrackId: 'dst',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        const store = makeStore({ routes: [existing] });
        const wire = vi.fn();
        injectDependencies(addSidechainRoute, {
            createSidechainRoute: vi.fn(),
            wireSidechainRoute: wire,
            unwireSidechainRoute: vi.fn(),
            sidechainStore: store as never,
        });

        addSidechainRoute('src', 'dst', 'dev1');

        expect(store.set).not.toHaveBeenCalled();
        expect(wire).not.toHaveBeenCalled();
    });

    it('removeSidechainRoute unwires and removes the route', () => {
        const route = {
            id: 'r1',
            sourceTrackId: 'src',
            targetTrackId: 'dst',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        const store = makeStore({ routes: [route] });
        const unwire = vi.fn();
        injectDependencies(removeSidechainRoute, {
            createSidechainRoute: vi.fn(),
            wireSidechainRoute: vi.fn(),
            unwireSidechainRoute: unwire,
            sidechainStore: store as never,
        });

        removeSidechainRoute('r1');

        expect(unwire).toHaveBeenCalledWith('src', 'dev1');
        expect(store.set).toHaveBeenCalledWith({ routes: [] });
    });

    it('setSidechainRoutes replaces all routes (unwire old, wire new)', () => {
        const oldRoute = {
            id: 'r1',
            sourceTrackId: 'a',
            targetTrackId: 'b',
            targetDeviceId: 'devA',
            targetParameterId: 'threshold',
        };
        const newRoute = {
            id: 'r2',
            sourceTrackId: 'c',
            targetTrackId: 'd',
            targetDeviceId: 'devB',
            targetParameterId: 'threshold',
        };
        const store = makeStore({ routes: [oldRoute] });
        const wire = vi.fn();
        const unwire = vi.fn();
        injectDependencies(setSidechainRoutes, {
            createSidechainRoute: vi.fn(),
            wireSidechainRoute: wire,
            unwireSidechainRoute: unwire,
            sidechainStore: store as never,
        });

        setSidechainRoutes([newRoute]);

        expect(unwire).toHaveBeenCalledWith('a', 'devA');
        expect(store.set).toHaveBeenCalledWith({ routes: [newRoute] });
        expect(wire).toHaveBeenCalledWith('c', 'd', 'devB');
    });

    it('getSidechainRoutesForTrack and getSidechainSource read raw store', () => {
        // These query helpers don't go through inject — they read the real module store.
        // Sanity-check they don't throw on a missing store value.
        expect(getSidechainRoutesForTrack('nope')).toEqual([]);
        expect(getSidechainSource('nope')).toBeNull();
        expect(getAllSidechainRoutes()).toEqual([]);
    });
});
