import { describe, expect, it } from 'vitest';

import { resolveToasterPadBinding } from '../resolveToasterPadBinding';

type BindingTrack = Parameters<typeof resolveToasterPadBinding>[0][number];

function track(id: string, parentId: string | null = null, deviceType?: string): BindingTrack {
    return { id, parentId, devices: deviceType ? [{ type: deviceType }] : [] };
}

describe('resolveToasterPadBinding', () => {
    it('maps Toaster children to their stable sibling index', () => {
        const tracks = [
            track('parent', null, 'toaster'),
            ...Array.from({ length: 16 }, (_, index) => track(`pad-${index}`, 'parent')),
        ];

        expect(resolveToasterPadBinding(tracks, 'pad-0')).toEqual({ toasterParentTrackId: 'parent', padIndex: 0 });
        expect(resolveToasterPadBinding(tracks, 'pad-15')).toEqual({ toasterParentTrackId: 'parent', padIndex: 15 });
    });

    it('rejects absent, non-Toaster, root, and seventeenth-child bindings', () => {
        const tracks = [
            track('plain-parent', null, 'fermenter'),
            track('plain-child', 'plain-parent'),
            track('toaster-parent', null, 'toaster'),
            ...Array.from({ length: 17 }, (_, index) => track(`pad-${index}`, 'toaster-parent')),
        ];

        expect(resolveToasterPadBinding(tracks, 'missing')).toBeUndefined();
        expect(resolveToasterPadBinding(tracks, 'plain-parent')).toBeUndefined();
        expect(resolveToasterPadBinding(tracks, 'plain-child')).toBeUndefined();
        expect(resolveToasterPadBinding(tracks, 'pad-16')).toBeUndefined();
    });
});
