import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrackStore, mockResolvePin } = vi.hoisted(() => ({
    mockTrackStore: { value: null as unknown as { tracks: Array<{ clips: Array<Record<string, unknown>> }> } },
    mockResolvePin: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mockTrackStore }));
vi.mock('#/modules/MIDI/useCases', () => ({
    resolveGrooveExtractionPin: mockResolvePin,
}));

import { proposeYeastGrooveExtraction } from '../proposeYeastGrooveExtraction';

function midiClip(id: string, name = id) {
    return { id, type: 'midi', name };
}

function stateWithClips(clips: Array<Record<string, unknown>>) {
    return { tracks: [{ id: 't1', name: 'T1', clips }] };
}

function resolvesTo(
    extraction: Record<string, unknown>,
    template?: Record<string, unknown>,
    templateId = 'groove-c1-v1'
) {
    mockResolvePin.mockReturnValue({ templateId, extraction, template });
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
        resolvesTo(extracted);
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('extracted');
        expect(result).toMatchObject({ clipId: 'c1', sourceName: 'My Clip', subdivision: '1/16' });
    });

    it('returns the straight groove with source metadata', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'On Grid')]);
        resolvesTo({
            status: 'straight',
            template: { id: 'groove-straight' },
        });
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('straight');
        expect(result).toMatchObject({ clipId: 'c1', sourceName: 'On Grid' });
    });

    it('returns invalid-source with reason when prepareGrooveExtraction rejects', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'Bad')]);
        resolvesTo({
            status: 'invalid-source',
            reason: 'No notes on grid positions',
        });
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('invalid-source');
        expect(result).toMatchObject({ reason: 'No notes on grid positions' });
    });

    it('returns empty/unsupported status passthrough with source metadata', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'Empty')]);
        resolvesTo({ status: 'empty' });
        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });
        expect(result.status).toBe('empty');
        expect(result).toMatchObject({ clipId: 'c1', sourceName: 'Empty', subdivision: '1/16' });
    });

    it('previews under the id and sourceName the clip resolves, with its own subdivision', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'My Clip')]);
        resolvesTo({ status: 'empty' }, undefined, 'groove-c1-v2');

        proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/8' });

        expect(mockResolvePin).toHaveBeenCalledWith({ clipId: 'c1', sourceName: 'My Clip', subdivision: '1/8' });
    });

    it('proposes the stored template, with the note revision, when the resolver reuses an existing version', () => {
        mockTrackStore.value = stateWithClips([midiClip('c1', 'Renamed')]);
        const stored = { id: 'groove-c1-v2', name: 'My Clip groove 2' };
        resolvesTo(
            {
                status: 'extracted',
                template: { id: 'groove-c1-v2', name: 'Renamed groove' },
                sourceRevision: 'rev-notes',
            },
            stored,
            'groove-c1-v2'
        );

        const result = proposeYeastGrooveExtraction({ clipId: 'c1', subdivision: '1/16' });

        expect(result).toMatchObject({ status: 'extracted', template: stored, sourceRevision: 'rev-notes' });
    });
});
