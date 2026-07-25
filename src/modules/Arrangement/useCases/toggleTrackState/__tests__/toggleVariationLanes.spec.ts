import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { toggleVariationLanes } from '#/modules/Arrangement/useCases/toggleTrackState/toggleVariationLanes';

describe('toggleVariationLanes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    name: 'Track',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    color: 'blue',
                    clips: [],
                    devices: [],
                    sends: [],
                    midiFx: [],
                    freezeState: { status: 'unfrozen' },
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    frozen: false,
                    parentId: null,
                    collapsed: false,
                    inputMonitoring: 'auto',
                    hidden: false,
                    disabled: false,
                    height: 80,
                    outputId: 'master',
                    automationMode: 'read',
                    groupId: null,
                    soloSafe: false,
                    notes: '',
                    inputId: null,
                    activeAlternativeId: 'alt-1',
                    alternatives: [],
                    followChordTrack: false,
                    showVariationLanes: false,
                },
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
    });

    it('should flip showVariationLanes flag', () => {
        toggleVariationLanes('t1');
        expect(trackStore.value?.tracks[0]?.showVariationLanes).toBe(true);
        toggleVariationLanes('t1');
        expect(trackStore.value?.tracks[0]?.showVariationLanes).toBe(false);
    });

    it('forces the lanes on when force=true is passed', () => {
        // start true, force true → stays true (no toggle)
        trackStore.set({
            ...trackStore.value!,
            tracks: [{ ...trackStore.value!.tracks[0]!, showVariationLanes: true }],
        });

        toggleVariationLanes('t1', true);
        expect(trackStore.value?.tracks[0]?.showVariationLanes).toBe(true);
    });

    it('forces the lanes off when force=false is passed', () => {
        // start true, force false → turns off (no toggle)
        trackStore.set({
            ...trackStore.value!,
            tracks: [{ ...trackStore.value!.tracks[0]!, showVariationLanes: true }],
        });

        toggleVariationLanes('t1', false);
        expect(trackStore.value?.tracks[0]?.showVariationLanes).toBe(false);
    });

    it('leaves other tracks untouched', () => {
        const other = { ...trackStore.value!.tracks[0]!, id: 't2', showVariationLanes: false };
        trackStore.set({ ...trackStore.value!, tracks: [trackStore.value!.tracks[0]!, other] });

        toggleVariationLanes('t1');
        expect(trackStore.value?.tracks[1]?.showVariationLanes).toBe(false);
    });

    it('is a no-op when the store has not loaded', () => {
        trackStore.set(null);

        toggleVariationLanes('t1');

        expect(trackStore.value).toBeNull();
    });
});
