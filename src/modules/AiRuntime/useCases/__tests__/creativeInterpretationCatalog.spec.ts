import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextClip, type ProjectContextTrack } from '../../models/ProjectContext';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { getExplicitClipProtection } from '../agentReference/getExplicitlyProtectedClips';
import { readExplicitProtections } from '../agentReference/readExplicitProtections';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

const clip = (id: string, name: string): ProjectContextClip => ({
    id,
    name,
    type: 'midi',
    startBeat: 0,
    endBeat: 4,
    noteCount: 0,
});

const track = (id: string, name: string, clips: ProjectContextClip[] = []): ProjectContextTrack => ({
    id,
    name,
    kind: 'midi',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: clips.length,
    deviceCount: 0,
    clips,
    devices: [],
});

function createContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 0,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        tracks: [],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
        ...overrides,
    };
}

const REVISION = 'revision-creative-catalog';

describe('prepareCreativeInterpretationCatalog', () => {
    it('publishes Drums alone and retains the Bass prohibition even when Bass is selected', () => {
        const prompt = 'Make Drums warmer; leave Bass alone';
        const context = createContext({
            tracks: [track('drums', 'Drums'), track('bass', 'Bass')],
            selectedTrackId: 'bass',
        });
        const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });

        expect(readExplicitProtections(prompt, context).protectedTrackIds).toEqual(['bass']);
        expect(catalog.targets.map((target) => target.objectIds)).toEqual([['drums']]);
        expect(catalog.constraints).toContainEqual(
            expect.objectContaining({ kind: 'protect-object', objectId: 'bass' })
        );
        const admission = admitCreativeInterpretation({
            catalog,
            projectRevision: REVISION,
            call: {
                name: 'selectCreativeInterpretation',
                arguments: {
                    catalogId: catalog.catalogId,
                    modeId: 'edit',
                    targetCandidateIds: catalog.targets.map((target) => target.candidateId),
                    editDimensionCandidateIds: catalog.dimensions
                        .filter((entry) => entry.dimension === 'processing')
                        .map((entry) => entry.candidateId),
                    constraintCandidateIds: catalog.constraints
                        .filter((entry) => entry.kind === 'protect-object')
                        .map((entry) => entry.candidateId),
                    creationSlotIds: [],
                    uncertainty: 'artistic',
                },
            },
        });
        expect(admission).toMatchObject({
            status: 'admitted',
            authority: {
                targets: [{ objectIds: ['drums'] }],
                prohibitions: [{ kind: 'protect-object', objectId: 'bass' }],
            },
        });
    });

    it.each([
        { prompt: 'Make it warmer; leave Bass alone', selectedTrackId: null },
        { prompt: 'Make Bass warmer; leave Bass alone', selectedTrackId: 'drums' },
    ])(
        'does not turn a protected-only or forbidden explicit reference into a new target: $prompt',
        ({ prompt, selectedTrackId }) => {
            const context = createContext({
                tracks: [track('drums', 'Drums'), track('bass', 'Bass')],
                selectedTrackId,
            });
            const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
            expect(catalog.targets).toEqual([]);
            expect(catalog.modes).not.toContain('edit');
        }
    );

    it.each([null, 'bass'] as const)(
        'does not recover a protected track or descendant from selected clip fallback (%s)',
        (selectedTrackId) => {
            const context = createContext({
                tracks: [track('bass', 'Bass', [clip('verse', 'Verse')])],
                selectedTrackId,
                selectedClipId: 'verse',
                selectedClipIds: ['verse'],
            });
            const catalog = prepareCreativeInterpretationCatalog({
                prompt: 'Make this warmer; leave Bass alone',
                context,
                projectRevision: REVISION,
            });
            expect(catalog.targets).toEqual([]);
            expect(catalog.creationSlots.some((slot) => slot.parentCandidateId?.startsWith('target-'))).toBe(false);
        }
    );

    it.each([
        { prompt: 'Make this warmer; leave selected clip unchanged', selectedClipIds: ['verse'] },
        { prompt: 'Make these warmer; leave selected clips unchanged', selectedClipIds: ['verse', 'chorus'] },
        { prompt: 'Make these warmer; leave "Verse" unchanged', selectedClipIds: ['verse', 'chorus'] },
    ])(
        'does not republish a protected clip, its inferred parent, or a narrowed clip set: $prompt',
        ({ prompt, selectedClipIds }) => {
            const context = createContext({
                tracks: [track('keys', 'Keys', [clip('verse', 'Verse'), clip('chorus', 'Chorus')])],
                selectedClipId: 'verse',
                selectedClipIds,
            });
            const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
            expect(getExplicitClipProtection(prompt, context).clips.map((entry) => entry.id)).toContain('verse');
            expect(catalog.targets).toEqual([]);
            expect(catalog.constraints).toContainEqual(
                expect.objectContaining({ kind: 'protect-object', objectId: 'verse' })
            );
            const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: REVISION });
            expect(answer.scopes).toContainEqual(expect.objectContaining({ objectIds: ['verse'] }));
        }
    );

    it.each([
        { prompt: 'Make Vocal warmer; keep Vocal fader unchanged', selectedTrackId: 'drums', targetId: 'vocal' },
        { prompt: 'Make this warmer; keep Vocal fader unchanged', selectedTrackId: 'drums', targetId: 'drums' },
        { prompt: 'Make this warmer; keep Vocal fader unchanged', selectedTrackId: 'vocal', targetId: 'vocal' },
    ])(
        'keeps control-only restrictions without treating their owner as a positive name or whole exclusion: $prompt/$selectedTrackId',
        ({ prompt, selectedTrackId, targetId }) => {
            const context = createContext({
                tracks: [track('drums', 'Drums'), track('vocal', 'Vocal')],
                selectedTrackId,
            });
            const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
            expect(catalog.targets.map((target) => target.objectIds)).toEqual([[targetId]]);
            expect(catalog.constraints).not.toContainEqual(
                expect.objectContaining({ kind: 'protect-object', objectId: 'vocal' })
            );
            expect(readExplicitProtections(prompt, context).protectedControls).toEqual([
                { trackId: 'vocal', actionTypes: ['setTrackGain'] },
            ]);
        }
    );

    it.each([
        'Make Drums warmer; leave the Ghost track unchanged',
        'Make Drums warmer; leave the Ghost clip unchanged',
        'Make Drums warmer; leave "Ghost" unchanged',
        'Make Drums warmer; leave Bass alone',
    ])('keeps unresolved or ambiguous protection from selecting another object: %s', (prompt) => {
        const context = createContext({
            tracks: [track('drums', 'Drums'), track('bass-a', 'Bass'), track('bass-b', 'Bass')],
            selectedTrackId: 'drums',
        });
        const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
        expect(catalog.modes).toEqual(['unresolved']);
        expect(catalog.targets).toEqual([]);
        expect(catalog.unresolvedExplicitReferences.length).toBeGreaterThan(0);
    });

    it('retains positive named clips and UTF16 references outside resolved protection clauses', () => {
        const context = createContext({
            tracks: [track('drums', '🥁 Drums', [clip('phrase', 'Lead Phrase')]), track('bass', 'Bass')],
            selectedTrackId: 'bass',
        });
        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'Make "🥁 Drums" and "Lead Phrase" warmer; leave Bass alone',
            context,
            projectRevision: REVISION,
        });
        expect(catalog.targets.map((target) => target.objectIds)).toEqual([['drums'], ['phrase']]);
    });

    it('does not replace an ambiguous protected clip name with an unrelated selection', () => {
        const context = createContext({
            tracks: [
                track('drums', 'Drums'),
                track('keys', 'Keys', [clip('verse-a', 'Verse')]),
                track('piano', 'Piano', [clip('verse-b', 'Verse')]),
            ],
            selectedTrackId: 'drums',
        });
        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'Make this warmer; leave "Verse" unchanged',
            context,
            projectRevision: REVISION,
        });
        expect(catalog.targets).toEqual([]);
        expect(catalog.modes).toEqual(['unresolved']);
        expect(catalog.unresolvedExplicitReferences.length).toBeGreaterThan(0);
    });

    it('keeps a genuine selected clip set protected even when its clips share a name', () => {
        const context = createContext({
            tracks: [
                track('drums', 'Drums'),
                track('keys', 'Keys', [clip('verse-a', 'Verse')]),
                track('piano', 'Piano', [clip('verse-b', 'Verse')]),
            ],
            selectedTrackId: 'drums',
            selectedClipId: 'verse-a',
            selectedClipIds: ['verse-a', 'verse-b'],
        });
        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'Make Drums warmer; leave selected clips unchanged',
            context,
            projectRevision: REVISION,
        });
        expect(catalog.targets.map((target) => target.objectIds)).toEqual([['drums']]);
        expect(catalog.unresolvedExplicitReferences).toEqual([]);
        expect(
            catalog.constraints
                .filter((constraint) => constraint.kind === 'protect-object')
                .map((constraint) => constraint.objectId)
        ).toEqual(['verse-a', 'verse-b']);
    });

    it('does not infer rhythm-bus mutation subjects from project shape for the original whole-project request', () => {
        const context = createContext({
            tracks: [
                track('drums', 'Drum Bus'),
                track('bass', 'Bass Bus'),
                track('vocal', 'Lead Vocal'),
                track('master', 'Master'),
            ],
        });
        const prompt =
            'Make the second chorus hit harder without changing any lead-vocal state, the tempo map, or the master chain.';
        const original = structuredClone(context);
        const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
        expect(readExplicitProtections(prompt, context).resolvedTrackClauses).toEqual([]);
        expect(catalog.targets.flatMap((target) => target.objectIds)).not.toContain('drums');
        expect(catalog.targets.flatMap((target) => target.objectIds)).not.toContain('bass');
        expect(context).toEqual(original);
    });

    it.each([
        { protection: '', expectedActions: 1 },
        { protection: '; keep Vocal fader unchanged', expectedActions: 0 },
    ])(
        'keeps processing selectable while the actual fader restriction still blocks gain: $protection',
        ({ protection, expectedActions }) => {
            const prompt = `Make Vocal warmer${protection}`;
            const context = createContext({ tracks: [track('vocal', 'Vocal')] });
            const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
            const admission = admitCreativeInterpretation({
                catalog,
                projectRevision: REVISION,
                call: {
                    name: 'selectCreativeInterpretation',
                    arguments: {
                        catalogId: catalog.catalogId,
                        modeId: 'edit',
                        targetCandidateIds: catalog.targets.map((target) => target.candidateId),
                        editDimensionCandidateIds: catalog.dimensions
                            .filter((entry) => entry.dimension === 'processing')
                            .map((entry) => entry.candidateId),
                        constraintCandidateIds: [],
                        creationSlotIds: [],
                        uncertainty: 'artistic',
                    },
                },
            });
            if (admission.status !== 'admitted') {
                throw new Error('Expected catalog-bound processing admission.');
            }
            const result = bridgeGroundedLlmToolCalls({
                prompt,
                context,
                creativeAuthority: admission.authority,
                calls: [{ name: 'setTrackGain', arguments: { trackId: 'vocal', gain: 0.7 } }],
            });
            expect(result.actions).toHaveLength(expectedActions);
            if (expectedActions === 0) {
                expect(result.rejections).toContainEqual(
                    expect.objectContaining({ reason: expect.stringMatching(/protect/u) })
                );
            }
        }
    );

    it('publishes the named track and no contextual candidate when the prompt names one', () => {
        const context = createContext({
            tracks: [track('track-lead', 'Lead Vocals'), track('track-bass', 'Bass')],
            selectedTrackId: 'track-bass',
        });

        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'make the Lead Vocals sit further back',
            context,
            projectRevision: REVISION,
        });

        expect(catalog.targets).toEqual([
            {
                candidateId: 'target-1',
                provenance: 'explicit-reference',
                objectType: 'track',
                objectIds: ['track-lead'],
                parentTrackId: null,
                label: 'Lead Vocals',
            },
        ]);
        expect(catalog.targets.filter((target) => target.provenance === 'contextual-selection')).toEqual([]);
    });

    it('resolves nothing and asks for clarification when a quoted name is not in the project', () => {
        const context = createContext({
            tracks: [track('track-lead', 'Lead Vocals')],
            selectedTrackId: 'track-lead',
        });

        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'warm up the "Horn Section" a little',
            context,
            projectRevision: REVISION,
        });

        expect(catalog.unresolvedExplicitReferences).toEqual(['Horn Section']);
        expect(catalog.modes).toEqual(['unresolved']);
        expect(catalog.targets).toEqual([]);
    });

    it('publishes a scalar selected clip and its parent track as two separate candidates', () => {
        const context = createContext({
            tracks: [track('track-keys', 'Keys', [clip('clip-verse', 'Verse')])],
            selectedTrackId: null,
            selectedClipId: 'clip-verse',
            selectedClipIds: ['clip-verse'],
        });

        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'give this some movement',
            context,
            projectRevision: REVISION,
        });

        expect(catalog.targets).toEqual([
            {
                candidateId: 'target-1',
                provenance: 'contextual-selection',
                objectType: 'clip',
                objectIds: ['clip-verse'],
                parentTrackId: 'track-keys',
                label: 'Verse',
            },
            {
                candidateId: 'target-2',
                provenance: 'contextual-selection',
                objectType: 'track',
                objectIds: ['track-keys'],
                parentTrackId: null,
                label: 'Keys',
            },
        ]);
    });

    it('publishes one clip-set for a plural selection and never a scalar clip derived from it', () => {
        const context = createContext({
            tracks: [track('track-keys', 'Keys', [clip('clip-verse', 'Verse'), clip('clip-chorus', 'Chorus')])],
            selectedTrackId: null,
            selectedClipId: 'clip-verse',
            selectedClipIds: ['clip-verse', 'clip-chorus'],
        });

        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'give these some movement',
            context,
            projectRevision: REVISION,
        });

        expect(catalog.targets).toEqual([
            {
                candidateId: 'target-1',
                provenance: 'contextual-selection',
                objectType: 'clip-set',
                objectIds: ['clip-verse', 'clip-chorus'],
                parentTrackId: null,
                label: '2 selected clips',
            },
        ]);
        expect(catalog.targets.filter((target) => target.objectType === 'clip')).toEqual([]);
    });

    it('publishes the active view without letting it create or remove a candidate', () => {
        const base = {
            tracks: [track('track-keys', 'Keys', [clip('clip-verse', 'Verse')])],
            selectedTrackId: 'track-keys',
            selectedClipId: 'clip-verse',
            selectedClipIds: ['clip-verse'],
        };
        const input = { prompt: 'give this some movement', projectRevision: REVISION };

        const arrange = prepareCreativeInterpretationCatalog({
            ...input,
            context: createContext({ ...base, activeView: 'arrange' }),
        });
        const clipView = prepareCreativeInterpretationCatalog({
            ...input,
            context: createContext({ ...base, activeView: 'clip' }),
        });

        expect(clipView.targets).toEqual(arrange.targets);
        expect(clipView.dimensions).toEqual(arrange.dimensions);
        expect(clipView.constraints).toEqual(arrange.constraints);
        expect(clipView.creationSlots).toEqual(arrange.creationSlots);
        expect(arrange.selection.activeView).toBe('arrange');
        expect(clipView.selection.activeView).toBe('clip');
    });

    it('offers only creation and reading when nothing is named or selected', () => {
        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'make something that sounds like a summer evening',
            context: createContext(),
            projectRevision: REVISION,
        });

        expect(catalog.targets).toEqual([]);
        expect(catalog.creationSlots).toEqual([
            { candidateId: 'slot-1', objectType: 'track', parentCandidateId: null, budget: 4 },
            { candidateId: 'slot-2', objectType: 'device', parentCandidateId: 'slot-1', budget: 4 },
            { candidateId: 'slot-3', objectType: 'clip', parentCandidateId: 'slot-1', budget: 8 },
        ]);
        expect(catalog.modes).toEqual(['create', 'read-only']);
    });

    it('gives every published creation slot its own selectable candidate id', () => {
        const catalog = prepareCreativeInterpretationCatalog({
            prompt: 'make it sound like a radio',
            context: createContext({ tracks: [track('track-lead', 'Lead Vocals')], selectedTrackId: 'track-lead' }),
            projectRevision: REVISION,
        });

        const candidateIds = catalog.creationSlots.map((slot) => slot.candidateId);
        expect(new Set(candidateIds).size).toBe(candidateIds.length);
        // A duplicate id resolves to whichever slot came first, so the later ones could never be
        // selected at all: the device slot below is exactly the one a processing request needs.
        expect(catalog.creationSlots).toEqual([
            { candidateId: 'slot-1', objectType: 'track', parentCandidateId: null, budget: 4 },
            { candidateId: 'slot-2', objectType: 'clip', parentCandidateId: 'target-1', budget: 8 },
            { candidateId: 'slot-3', objectType: 'notes', parentCandidateId: 'target-1', budget: 256 },
            { candidateId: 'slot-4', objectType: 'device', parentCandidateId: 'target-1', budget: 4 },
            { candidateId: 'slot-5', objectType: 'device', parentCandidateId: 'slot-1', budget: 4 },
            { candidateId: 'slot-6', objectType: 'clip', parentCandidateId: 'slot-1', budget: 8 },
        ]);
    });

    it('keeps the catalog id stable for equal inputs and moves it when the request changes', () => {
        const context = createContext({ tracks: [track('track-lead', 'Lead Vocals')] });
        const input = { context, projectRevision: REVISION };

        const first = prepareCreativeInterpretationCatalog({ ...input, prompt: 'make it feel bigger' });
        const second = prepareCreativeInterpretationCatalog({ ...input, prompt: 'make it feel bigger' });
        const different = prepareCreativeInterpretationCatalog({ ...input, prompt: 'make it feel smaller' });

        expect(second.catalogId).toBe(first.catalogId);
        expect(different.catalogId).not.toBe(first.catalogId);
    });
});
