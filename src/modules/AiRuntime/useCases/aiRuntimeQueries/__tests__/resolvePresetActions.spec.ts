import { describe, it, expect } from 'vitest';

import { resolvePresetActions } from '../resolvePresetActions';

describe('resolvePresetActions', () => {
    const context = {
        selectedTrackId: undefined,
        selectedClipId: undefined,
        selectedClipType: undefined,
        trackCount: 1,
    };

    it('returns an empty array if preset is not found', () => {
        const result = resolvePresetActions({ presetId: 'missing', context });
        expect(result).toEqual([]);
    });

    it('wraps a single preset action in an array', () => {
        const result = resolvePresetActions({ presetId: 'save', context });
        expect(result).toEqual([{ type: 'saveProject' }]);
    });

    it('returns an empty array if buildAction returns null', () => {
        const result = resolvePresetActions({ presetId: 'invert-auto', context });
        expect(result).toEqual([]);
    });

    it('returns undo and redo as structured actions', () => {
        expect(resolvePresetActions({ presetId: 'undo', context })).toEqual([{ type: 'undo' }]);
        expect(resolvePresetActions({ presetId: 'redo', context })).toEqual([{ type: 'redo' }]);
    });

    it('returns preferences as a Workspace-owned structured action', () => {
        const result = resolvePresetActions({ presetId: 'preferences', context });
        expect(result).toEqual([{ type: 'openPreferencesDialog' }]);
    });
});
