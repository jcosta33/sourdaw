import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Track } from '../../stores/trackStore';
import { refreshToasterPadBindings } from '../refreshToasterPadBindings';

const mocks = vi.hoisted(() => ({
    setTrackOutput: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setTrackOutput: mocks.setTrackOutput,
    resolveToasterPadBinding: mocks.resolveToasterPadBinding,
}));

function toasterParent(id: string): Track {
    return TrackDummy.create({
        id,
        kind: 'folder',
        devices: [{ id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
    });
}

describe('refreshToasterPadBindings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveToasterPadBinding.mockReturnValue(null);
    });

    it('is a no-op when no parent id is supplied', () => {
        refreshToasterPadBindings([toasterParent('p1')], null);

        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
        expect(mocks.resolveToasterPadBinding).not.toHaveBeenCalled();
    });

    it('is a no-op when the parent has no toaster device', () => {
        const parent = TrackDummy.create({ id: 'p1', kind: 'folder', devices: [] });

        refreshToasterPadBindings([parent], 'p1');

        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
    });

    it('is a no-op when the parent identity is ambiguous (duplicate ids)', () => {
        const parent = toasterParent('p1');

        refreshToasterPadBindings([parent, { ...parent }], 'p1');

        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
    });

    it('rebinds every child output to the toaster parent and applies a resolved binding', () => {
        const childA = TrackDummy.create({ id: 'c1', parentId: 'p1', outputId: 'master' });
        const childB = TrackDummy.create({ id: 'c2', parentId: 'p1', outputId: 'p1' });
        mocks.resolveToasterPadBinding.mockImplementation((_tracks, childId) =>
            childId === 'c1' ? 'toaster-pad-1' : null
        );

        refreshToasterPadBindings([toasterParent('p1'), childA, childB], 'p1');

        // Each child is first routed to its declared output, then the resolved
        // binding is layered on top for children that have one.
        expect(mocks.setTrackOutput).toHaveBeenCalledWith('c1', 'master');
        expect(mocks.setTrackOutput).toHaveBeenCalledWith('c2', 'p1');
        expect(mocks.setTrackOutput).toHaveBeenCalledWith('c1', 'master', 'toaster-pad-1');
        // No binding for c2 -> no second setTrackOutput for it.
        const c2Calls = mocks.setTrackOutput.mock.calls.filter((call) => call[0] === 'c2');
        expect(c2Calls).toHaveLength(1);
    });
});
