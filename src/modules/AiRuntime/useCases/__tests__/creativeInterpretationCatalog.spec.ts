import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextClip, type ProjectContextTrack } from '../../models/ProjectContext';
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
        expect(catalog.creationSlots.map((slot) => slot.objectType)).toEqual(['track', 'clip', 'notes', 'device']);
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
