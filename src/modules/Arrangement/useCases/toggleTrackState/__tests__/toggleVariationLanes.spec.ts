import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleVariationLanes } from '#/modules/Arrangement/useCases/toggleTrackState/toggleVariationLanes';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

describe('toggleVariationLanes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({
            tracks: [{ id: 't1', name: 'Track', kind: 'audio', muted: false, soloed: false, armed: false, gain: 0.8, pan: 0, color: 'blue', clips: [], devices: [], sends: [], frozen: false, parentId: null, collapsed: false, inputMonitoring: 'auto', hidden: false, disabled: false, height: 80, outputId: 'master', automationMode: 'read', groupId: null, soloSafe: false, notes: '', inputId: null, activeAlternativeId: 'alt-1', alternatives: [], followChordTrack: false, showVariationLanes: false }],
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
});
