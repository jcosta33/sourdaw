import { describe, expect, it } from 'vitest';

import { getProjectContext } from '../getProjectContext';
import { readTargetCarriesAudio } from '../readTargetCarriesAudio';

import { createPlanningProject } from './planningProjectFixture';

type Track = ReturnType<typeof createPlanningProject>['tracks'][number];

function track(id: string, options: { hasClip?: boolean; outputId?: string; kind?: Track['kind'] } = {}): Track {
    const [template] = createPlanningProject(getProjectContext(), 1).tracks;
    const [clip] = template?.clips ?? [];
    if (template === undefined || clip === undefined) {
        throw new Error('Expected a planning fixture track holding a clip.');
    }
    return {
        ...template,
        id,
        kind: options.kind ?? 'audio',
        clips: options.hasClip === true ? [clip] : [],
        outputId: options.outputId,
        sends: [],
    };
}

describe('readTargetCarriesAudio', () => {
    it('resolves a target the context does not hold to audio, since every unknown reads as audio', () => {
        expect(readTargetCarriesAudio({ tracks: [track('a', { hasClip: true })] }, 'missing')).toBe(true);
    });

    it('reads a track with no clip and no feeding source as silent', () => {
        expect(readTargetCarriesAudio({ tracks: [track('empty')] }, 'empty')).toBe(false);
    });

    it('reads a bus fed by a track holding a clip as carrying audio', () => {
        const context = {
            tracks: [track('bus', { kind: 'bus' }), track('source', { hasClip: true, outputId: 'bus' })],
        };
        expect(readTargetCarriesAudio(context, 'bus')).toBe(true);
    });

    it('ends a routing cycle of silent buses on the revisit and reads it silent', () => {
        const context = {
            tracks: [
                track('first', { kind: 'bus', outputId: 'second' }),
                track('second', { kind: 'bus', outputId: 'first' }),
            ],
        };
        expect(readTargetCarriesAudio(context, 'first')).toBe(false);
    });
});
