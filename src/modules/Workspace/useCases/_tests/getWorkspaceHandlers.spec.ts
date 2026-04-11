import { describe, it, expect } from 'vitest';
import { getWorkspaceHandlers } from '../getWorkspaceHandlers';

describe('getWorkspaceHandlers', () => {
    it('returns a fresh map containing every workspace command handler', () => {
        const map = getWorkspaceHandlers();

        // spot check a representative cross-section of action types
        for (const key of [
            'setWorkspaceMode',
            'openMixer',
            'toggleSidebar',
            'addMarker',
            'addSection',
            'addAutomationLane',
            'quantizeNotes',
            'transposeNotes',
            'importMidiFile',
            'zoomToFit',
            'exportProject',
            'newProject',
        ] as const) {
            expect(map[key]).toBeDefined();
            expect(map[key].execute).toBeDefined();
        }

        expect(getWorkspaceHandlers()).not.toBe(map);
    });
});
