import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { projectsClipsByTempo, projectsClipsByTempoActionType } from '../ProjectsClipsByTempoActionType';

describe('projectsClipsByTempoActionType', () => {
    it('marks exactly the actions whose replay rewrites clips through the tempo projection', () => {
        const marked = Object.entries(projectsClipsByTempoActionType)
            .filter(([, projectsClips]) => projectsClips)
            .map(([type]) => type);

        expect(marked.toSorted()).toEqual(['restoreTempoEdit', 'setTempo']);
    });

    it('answers false for editTempoMap, which keeps clip state', () => {
        expect(projectsClipsByTempo('editTempoMap')).toBe(false);
    });

    it('answers false for an inherited name read from untrusted JSON', () => {
        const parsed: Pick<AppAction, 'type'> = JSON.parse('{"type":"constructor"}');

        expect(projectsClipsByTempo(parsed.type)).toBe(false);
    });
});
