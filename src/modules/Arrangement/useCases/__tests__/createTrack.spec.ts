import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack as modelCreateTrack, normalizeTrack as modelNormalizeTrack, type Track } from '../../models/Track';
import { createTrack } from '../createTrack';
import { normalizeTrack } from '../normalizeTrack';

vi.mock('../../models/Track', () => ({
    createTrack: vi.fn(),
    normalizeTrack: vi.fn(),
}));

function createTrackResult(overrides: Partial<Track>): Track {
    return {
        id: 'track-result',
        name: 'Track Result',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
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
        activeAlternativeId: 'alt-result',
        alternatives: [{ id: 'alt-result', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

describe('createTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to the Arrangement model createTrack and return its track', () => {
        const input = { name: 'Lead', kind: 'midi' as const, parentId: 'folder-1' };
        const expectedTrack = createTrackResult({
            id: 'track-created',
            name: 'Lead',
            kind: 'midi',
            parentId: 'folder-1',
        });
        vi.mocked(modelCreateTrack).mockReturnValue(expectedTrack);

        const track = createTrack(input);

        expect(modelCreateTrack).toHaveBeenCalledTimes(1);
        expect(modelCreateTrack).toHaveBeenCalledWith(input);
        expect(track).toBe(expectedTrack);
    });
});

describe('normalizeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to the Arrangement model normalizeTrack and return its track', () => {
        const input = { id: 'track-imported', name: 'Imported Audio', kind: 'audio' as const, muted: true };
        const expectedTrack = createTrackResult({
            id: 'track-imported',
            name: 'Imported Audio',
            muted: true,
        });
        vi.mocked(modelNormalizeTrack).mockReturnValue(expectedTrack);

        const track = normalizeTrack(input);

        expect(modelNormalizeTrack).toHaveBeenCalledTimes(1);
        expect(modelNormalizeTrack).toHaveBeenCalledWith(input);
        expect(track).toBe(expectedTrack);
    });
});
