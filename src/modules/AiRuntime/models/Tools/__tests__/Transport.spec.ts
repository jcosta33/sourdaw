import { describe, expect, it } from 'vitest';

import { transportTools } from '../Transport';

describe('transportTools', () => {
    it('exposes explicit playback state without playback or recording toggles', () => {
        const names = transportTools.map((schema) => schema.function.name);
        const playback = transportTools.find((schema) => schema.function.name === 'setPlayback');

        expect(playback?.function.parameters).toMatchObject({
            properties: { playing: { type: 'boolean' } },
            required: ['playing'],
        });
        expect(names).toContain('stopPlayback');
        expect(
            transportTools.find((schema) => schema.function.name === 'setPunchEnabled')?.function.parameters
        ).toEqual({
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
        });
        expect(names).not.toContain('togglePlayback');
        expect(names).not.toContain('toggleRecording');
        expect(names).not.toContain('togglePunch');
    });
});
