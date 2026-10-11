import { describe, expect, it } from 'vitest';

import { deriveAutoMonitorEdge } from '../deriveAutoInputMonitoring';

type Row = {
    armed: boolean;
    isPlaying: boolean;
    isRecording: boolean;
    edge: 'open' | 'closed';
};

const AUTO_MATRIX: readonly Row[] = [
    { armed: true, isPlaying: false, isRecording: false, edge: 'open' },
    { armed: true, isPlaying: true, isRecording: true, edge: 'open' },
    { armed: true, isPlaying: false, isRecording: true, edge: 'open' },
    { armed: true, isPlaying: true, isRecording: false, edge: 'closed' },
    { armed: false, isPlaying: false, isRecording: false, edge: 'closed' },
    { armed: false, isPlaying: true, isRecording: false, edge: 'closed' },
    { armed: false, isPlaying: true, isRecording: true, edge: 'closed' },
    { armed: false, isPlaying: false, isRecording: true, edge: 'closed' },
];

describe('deriveAutoMonitorEdge', () => {
    it.each(AUTO_MATRIX)(
        'derives $edge for an Auto track (armed $armed, playing $isPlaying, recording $isRecording)',
        ({ edge, ...state }) => {
            expect(deriveAutoMonitorEdge({ inputMonitoring: 'auto', ...state })).toBe(edge);
        }
    );

    it.each(['on', 'off'] as const)('leaves %s monitoring unmanaged in every transport state', (inputMonitoring) => {
        for (const armed of [true, false]) {
            for (const isPlaying of [true, false]) {
                for (const isRecording of [true, false]) {
                    expect(deriveAutoMonitorEdge({ inputMonitoring, armed, isPlaying, isRecording })).toBe('unmanaged');
                }
            }
        }
    });
});
