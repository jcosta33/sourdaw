import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { type CreativeInterpretationCatalog } from '../../models/CreativeInterpretation';
import { type ProjectContext } from '../../models/ProjectContext';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../..');
const REVISION = 'revision-creative-targets';

/**
 * The campaign fixture as production plans against it: `getProjectContext` derives every track's
 * canonical role through `getCanonicalTrackRole`, so the raw file's missing roles (Bass DI, Guitar,
 * Keys, the buses) are filled the same way here.
 */
function fixtureContext(): ProjectContext {
    const fixture = JSON.parse(
        readFileSync(resolve(REPOSITORY_ROOT, 'evidence/agent-campaign/corpora/fixture-project.json'), 'utf8')
    ) as ProjectContext;
    return {
        ...fixture,
        tracks: fixture.tracks.map((track) => ({
            ...track,
            canonicalRole: getCanonicalTrackRole({
                track: { id: track.id, name: track.name, kind: track.kind, clips: [], devices: [] },
            }),
        })),
    };
}

function prepare(prompt: string, context: ProjectContext = fixtureContext()): CreativeInterpretationCatalog {
    return prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
}

function slotParents(catalog: CreativeInterpretationCatalog, objectType: 'device' | 'clip' | 'notes'): string[] {
    return catalog.creationSlots
        .filter((slot) => slot.objectType === objectType)
        .flatMap((slot) => (slot.parentCandidateId === null ? [] : [slot.parentCandidateId]));
}

describe('creative catalog creation slots', () => {
    it('hangs a device and a clip slot under every published track target, the comparison subject included', () => {
        const catalog = prepare('make the guitar brighter than the hi-hat in the intro');

        const guitar = catalog.targets.find((target) => target.objectIds.includes('track-guitar'));
        const hiHat = catalog.targets.find((target) => target.objectIds.includes('track-hi-hat'));
        expect(guitar?.provenance).toBe('explicit-reference');
        expect(hiHat?.provenance).toBe('explicit-reference');
        for (const target of [guitar, hiHat]) {
            expect(slotParents(catalog, 'device')).toContain(target?.candidateId);
            expect(slotParents(catalog, 'clip')).toContain(target?.candidateId);
        }
        const ids = catalog.creationSlots.map((slot) => slot.candidateId);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
