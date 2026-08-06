import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrackStore, mockPrepareExtraction } = vi.hoisted(() => ({
    mockTrackStore: { value: null as unknown as { tracks: Array<{ clips: Array<Record<string, unknown>> }> } },
    mockPrepareExtraction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mockTrackStore }));
vi.mock('#/modules/MIDI/useCases', () => ({ prepareGrooveExtraction: mockPrepareExtraction }));

import { proposeYeastGrooveExtraction } from '../proposeYeastGrooveExtraction';

function midiClip(id: string, name = id) {
    return { id, type: 'midi', name };
}

function stateWithClips(clips: Array<Record<string, unknown>>) {
    return { tracks: [{ id: 't1', name: 'T1', clips }] };
}

describe('proposeYeastGrooveExtraction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns ineligible-clip when the clip is not found', () => {
        mockTrackStore.value = stateWithClips([]);
        const result = proposeYeastGrooveExtraction({ clipId: 'missing', subdivision: '1/16' });
        expect(result.status).toBe('ineligible-clip');
    });

    it('returns ineligible-clip when the clip is not MIDI type', () => {
        mockTrackStore.value = stateWithClips([{ id: 'c1', type: 'audio', name: 'Audio' }]);
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('ineligible-clip');
    });

    it('returns the extracted groove with source metadata', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'My Clip')]);
        const extracted = {
            status: 'extracted' as const,
            template: { id: 'groove-c1-v1', name: 'My Clip groove' },
        };
        mockPrepareExtraction.mockReturnValue(extracted);
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('extracted');
        expect(result).toMatchObject({ clipId: 'c1', sourceName: 'My Clip', subdivision: '1/16' });
    });

    it('returns the straight groove with source metadata', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'On Grid')]);
        mockPrepareExtraction.mockReturnValue({
            status: 'straight',
            template: { id: 'groove-straight' },
        });
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('straight');
        expect(result).toMatchObject({ clipId: 'c1', sourceName: 'On Grid' });
    });

    it('returns invalid-source with reason when prepareGrooveExtraction rejects', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'Bad')]);
        mockPrepareExtraction.mockReturnValue({
            status: 'invalid-source',
            reason: 'No notes on grid positions',
        });
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('invalid-source');
        expect(result).toMatchObject({ reason: 'No notes on grid positions' });
    });

    it('returns empty/unsupported status passthrough with source metadata', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'Empty')]);
        mockPrepareExtraction.mockReturnValue({ status: 'empty' });
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('empty');
        expect(result).toMatchObject({ clipId: 'c1', sourceName: 'Empty', subdivision: '1/16' });
    });
});
