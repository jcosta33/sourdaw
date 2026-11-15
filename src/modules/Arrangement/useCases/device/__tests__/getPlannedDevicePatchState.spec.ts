import { describe, expect, it } from 'vitest';

import { plannedDeviceWriteStepByActionType } from '../getPlannedDevicePatchState';

describe('plannedDeviceWriteStepByActionType', () => {
    it('treats exactly these actions as other than a plain command step', () => {
        const plain = plannedDeviceWriteStepByActionType.selectTrack;
        const specialEntries = Object.entries(plannedDeviceWriteStepByActionType).filter(
            ([, entry]) => entry !== plain
        );
        const special = specialEntries.map(([type]) => type).sort();
        expect(special).toEqual(['addTrack', 'createBus', 'setFermenterPatch', 'restoreTrack'].sort());
    });

    it('keeps an unrelated action as a command step and records no track id', () => {
        const trackIds = new Set<string>();
        const action = { type: 'selectTrack', payload: { trackId: 't' } } as const;
        expect(plannedDeviceWriteStepByActionType.selectTrack(action, trackIds)).toEqual({ kind: 'command', action });
        expect(trackIds.size).toBe(0);
    });

    it('records the id an added track or created bus brings and keeps the command step', () => {
        const trackIds = new Set<string>();
        const added = { type: 'addTrack', payload: { id: 'a', kind: 'audio' } } as const;
        const bus = { type: 'createBus', payload: { busId: 'b', name: 'Bus' } } as const;
        expect(plannedDeviceWriteStepByActionType.addTrack(added, trackIds)).toEqual({
            kind: 'command',
            action: added,
        });
        expect(plannedDeviceWriteStepByActionType.createBus(bus, trackIds)).toEqual({ kind: 'command', action: bus });
        expect([...trackIds].sort()).toEqual(['a', 'b']);
    });

    it('abandons the plan for a restored track whose snapshot does not own its id', () => {
        const trackIds = new Set<string>();
        const restore = {
            type: 'restoreTrack',
            payload: { trackId: 'a', trackSnapshot: { id: 'other' } },
        } as unknown as Parameters<typeof plannedDeviceWriteStepByActionType.restoreTrack>[0];
        expect(plannedDeviceWriteStepByActionType.restoreTrack(restore, trackIds)).toBeNull();
        expect(trackIds.size).toBe(0);
    });
});
