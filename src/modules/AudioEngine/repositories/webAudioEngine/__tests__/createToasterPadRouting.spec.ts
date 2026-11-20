import { describe, expect, it, vi } from 'vitest';

import { createToasterPadRouting } from '../createToasterPadRouting';

import type { BuiltinDeviceNode, ToasterDeviceControls, TrackChannelStrip } from '../../../models/AudioEngineState';

function createControls() {
    return {
        connectPadOutput: vi.fn(),
        disconnectPadOutput: vi.fn(),
        setPadDryRouted: vi.fn(),
    };
}

function createFixture() {
    const controls = createControls();
    const childGain = { id: 'child-gain' } as unknown as GainNode;
    const strips = new Map<string, TrackChannelStrip>([
        ['parent', { deviceNodes: [{ toasterControls: controls }] } as unknown as TrackChannelStrip],
        ['child', { gainNode: childGain, deviceNodes: [] } as unknown as TrackChannelStrip],
    ]);
    const routing = createToasterPadRouting({ readTrackStrip: (trackId) => strips.get(trackId) });
    return { routing, controls, childGain, strips };
}

describe('createToasterPadRouting', () => {
    it('dry-routes a newly bound pad into the source strip once', () => {
        const { routing, controls, childGain } = createFixture();

        expect(routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 3 })).toBe(true);
        expect(routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 3 })).toBe(false);

        expect(controls.connectPadOutput).toHaveBeenCalledExactlyOnceWith(3, childGain);
        expect(controls.setPadDryRouted).toHaveBeenCalledExactlyOnceWith(3, true);
        expect(routing.routes.get('child')).toMatchObject({ destinationNode: childGain, controls });
        expect(routing.hasLiveRoute()).toBe(true);
    });

    it('detaches and forgets a route whose binding becomes invalid', () => {
        const { routing, controls, childGain } = createFixture();
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 3 });

        expect(routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 16 })).toBe(true);
        expect(routing.updateBinding('child', undefined)).toBe(false);

        expect(controls.disconnectPadOutput).toHaveBeenCalledExactlyOnceWith(3, childGain);
        expect(controls.setPadDryRouted).toHaveBeenLastCalledWith(3, false);
        expect(routing.routes.size).toBe(0);
    });

    it('moves a route to its new pad', () => {
        const { routing, controls, childGain } = createFixture();
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 3 });

        expect(routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 5 })).toBe(true);

        expect(controls.disconnectPadOutput).toHaveBeenCalledExactlyOnceWith(3, childGain);
        expect(controls.connectPadOutput).toHaveBeenLastCalledWith(5, childGain);
    });

    it('holds a binding until its Toaster loads, then routes it on reconcile', () => {
        const { routing, strips, childGain } = createFixture();
        strips.set('late', { deviceNodes: [] } as unknown as TrackChannelStrip);
        routing.updateBinding('child', { toasterParentTrackId: 'late', padIndex: 1 });
        expect(routing.routes.get('child')?.destinationNode).toBeNull();

        const lateControls = createControls();
        strips.set('late', { deviceNodes: [{ toasterControls: lateControls }] } as unknown as TrackChannelStrip);
        routing.reconcileParent('late');

        expect(lateControls.connectPadOutput).toHaveBeenCalledExactlyOnceWith(1, childGain);
        expect(routing.routes.get('child')?.controls).toBe(lateControls);
    });

    it('detaches the pads of a removed Toaster and ignores other removed devices', () => {
        const { routing, controls, childGain } = createFixture();
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 2 });

        routing.handleDeviceRemoved('parent', { type: 'builtin-eq' } as unknown as BuiltinDeviceNode);
        expect(controls.disconnectPadOutput).not.toHaveBeenCalled();

        routing.handleDeviceRemoved('parent', {
            type: 'toaster',
            toasterControls: controls,
        } as unknown as BuiltinDeviceNode);
        expect(controls.disconnectPadOutput).toHaveBeenCalledExactlyOnceWith(2, childGain);
    });

    it('restores a snapshot by clearing the attempted pad and re-attaching the snapshot pad', () => {
        const { routing, controls, childGain } = createFixture();
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 1 });
        const snapshot = routing.snapshotRoute('child');
        const attempted = { toasterParentTrackId: 'parent', padIndex: 2 };
        routing.updateBinding('child', attempted);
        controls.connectPadOutput.mockClear();

        routing.restoreBinding('child', childGain, snapshot, attempted);

        expect(controls.disconnectPadOutput).toHaveBeenLastCalledWith(2, childGain);
        expect(controls.connectPadOutput).toHaveBeenCalledExactlyOnceWith(1, childGain);
        expect(controls.setPadDryRouted).toHaveBeenLastCalledWith(1, true);
        expect(routing.routes.get('child')).toMatchObject({ padIndex: 1, destinationNode: childGain });
    });

    it('rethrows a single cleanup failure after restoring the route state', () => {
        const { routing, controls, childGain } = createFixture();
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 1 });
        const failure = new Error('disconnect failed');
        controls.disconnectPadOutput.mockImplementation(() => {
            throw failure;
        });

        expect(() => routing.restoreBinding('child', childGain, undefined, undefined)).toThrow(failure);
        expect(routing.routes.has('child')).toBe(false);
    });

    it('refuses to re-attach a snapshot whose controls cannot connect a pad output', () => {
        const { routing, childGain } = createFixture();
        const controls = { setPadDryRouted: vi.fn() } as unknown as ToasterDeviceControls;

        expect(() =>
            routing.restoreBinding(
                'child',
                childGain,
                { toasterParentTrackId: 'parent', padIndex: 1, destinationNode: childGain, controls, dryRouted: true },
                undefined
            )
        ).toThrow('Toaster pad route snapshot has no connect output control');
    });

    it('forgets a removed strip’s own route and the routes its Toaster owned', () => {
        const { routing, strips } = createFixture();
        strips.set('other', { gainNode: {} as GainNode, deviceNodes: [] } as unknown as TrackChannelStrip);
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 1 });
        routing.updateBinding('other', { toasterParentTrackId: 'elsewhere', padIndex: 1 });

        routing.forgetRoutesOfRemovedStrip('parent');
        expect(Array.from(routing.routes.keys())).toEqual(['other']);

        routing.forgetRoutesOfRemovedStrip('other');
        expect(routing.routes.size).toBe(0);
    });

    it('returns two pad teardown effects per dry-routed pad only', () => {
        const { routing, controls, childGain, strips } = createFixture();
        strips.set('other', { gainNode: {} as GainNode, deviceNodes: [] } as unknown as TrackChannelStrip);
        routing.updateBinding('child', { toasterParentTrackId: 'parent', padIndex: 4 });
        routing.updateBinding('other', { toasterParentTrackId: 'elsewhere', padIndex: 1 });

        const effects = routing.resetEffects();
        for (const effect of effects) {
            effect();
        }
        routing.clear();

        expect(effects).toHaveLength(2);
        expect(controls.disconnectPadOutput).toHaveBeenCalledExactlyOnceWith(4, childGain);
        expect(controls.setPadDryRouted).toHaveBeenLastCalledWith(4, false);
        expect(routing.routes.size).toBe(0);
        expect(routing.hasLiveRoute()).toBe(false);
    });
});
