import { describe, expect, it } from 'vitest';

import { compileAudioGraphTopology } from '../compileAudioGraphTopology';

describe('compileAudioGraphTopology', () => {
    it('compiles strip, output, send, and sidechain edges without creating runtime nodes', () => {
        expect(
            compileAudioGraphTopology({
                tracks: [
                    {
                        id: 'source',
                        kind: 'audio',
                        outputId: 'bus',
                        devices: [],
                        sends: [{ busId: 'bus', level: 0.5 }],
                    },
                    {
                        id: 'bus',
                        kind: 'bus',
                        outputId: 'master',
                        devices: [{ id: 'compressor', type: 'builtin-compressor' }],
                        sends: [],
                    },
                ],
                sidechainRoutes: [{ sourceTrackId: 'source', targetTrackId: 'bus', targetDeviceId: 'compressor' }],
            })
        ).toEqual({ status: 'compiled', edgeCount: 4, nodeIds: ['bus', 'source'] });
    });

    it('rejects a structurally present output target that has no live audio node', () => {
        expect(
            compileAudioGraphTopology({
                tracks: [
                    { id: 'source', kind: 'audio', outputId: 'folder', devices: [], sends: [] },
                    { id: 'folder', kind: 'folder', outputId: 'master', devices: [], sends: [] },
                ],
                sidechainRoutes: [],
            })
        ).toEqual({ status: 'invalid', reason: 'Track output has no audio node: source -> folder' });
    });

    it('compiles a valid project containing a nodeless VCA track', () => {
        expect(
            compileAudioGraphTopology({
                tracks: [
                    { id: 'source', kind: 'audio', outputId: 'master', devices: [], sends: [] },
                    { id: 'vca-drums', kind: 'vca', outputId: 'master', devices: [], sends: [] },
                ],
                sidechainRoutes: [],
            })
        ).toEqual({ status: 'compiled', edgeCount: 1, nodeIds: ['source'] });
    });
});
