import { describe, it, expect, vi } from 'vitest';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [], selectedTrackId: null }, set: vi.fn() },
    markerStore: { value: { markers: [], sections: [] }, set: vi.fn() },
    grooveStore: { value: null, set: vi.fn() },
    vcaGroupStore: { value: [], set: vi.fn() },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    createTrack: vi.fn(() => ({
        id: 't1',
        name: 'Track',
        clips: [],
        devices: [],
        alternatives: [{ id: 'a1', clips: [] }],
    })),
}));
vi.mock('#/modules/MIDI/stores', () => ({ chordTrackStore: { value: null, set: vi.fn() } }));
vi.mock('#/modules/Routing/useCases', () => ({ addSidechainRoute: vi.fn() }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: null, set: vi.fn() },
    defaultTransportState: {
        tempo: 120,
        isPlaying: false,
        isLooping: false,
        isRecording: false,
        punchInEnabled: false,
        punchOutEnabled: false,
        position: 0,
        loopStart: 0,
        loopEnd: 0,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        countInEnabled: false,
        countInBars: 1,
        overdubEnabled: false,
        autoScrollEnabled: true,
        punchInBeat: 0,
        punchOutBeat: 16,
        preRollBeats: 4,
        postRollBeats: 2,
    },
}));
vi.mock('#/modules/Transport/useCases', () => ({ ensureTrackStrips: vi.fn() }));
vi.mock('#/modules/Workspace/stores', () => ({ preferencesStore: { value: {}, set: vi.fn() } }));
vi.mock('../../../../stores/projectStore', () => ({ projectStore: { value: null, set: vi.fn() } }));
vi.mock('../../../demoProjects/demoUtils/syncArrangement', () => ({ syncArrangement: vi.fn() }));

import { initProject } from '../initProject';

describe('template builder', () => {
    it('initProject creates a project', () => {
        const result = initProject({ name: 'Test', tempo: 120 } as never);
        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
    });
});
