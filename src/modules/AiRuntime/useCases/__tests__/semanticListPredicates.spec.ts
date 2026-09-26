import { describe, expect, it } from 'vitest';

import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

import type { ProjectContext } from '../../models/ProjectContext';

/** Same base track shape `compileArbitraryCommandList.spec.ts` uses, widened with the owner facts a `match` predicate reads. */
const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    productionBrief: {
        schemaVersion: 1,
        id: 'brief-1',
        revision: 1,
        vision: null,
        references: [],
        hardConstraints: [],
        preferences: [],
        sectionGoals: [],
        trackRoles: [{ id: 'brief-role-vox', trackId: 'track-vox', role: 'Doubler', createdAt: 0 }],
        locks: [],
        decisions: [],
        unresolvedQuestions: [],
        sourceRunLinks: [],
        supersedesBriefId: null,
        supersededByBriefId: null,
        createdAt: 0,
        updatedAt: 0,
    },
    sections: [{ id: 'section-chorus', name: 'Chorus', startBeat: 8, endBeat: 16 }],
    automationLanes: [
        {
            id: 'lane-kick-gain',
            trackId: 'track-kick',
            parameterId: 'gain',
            name: 'Kick Gain',
            enabled: true,
            minValue: 0,
            maxValue: 1,
            points: [],
        },
    ],
    adjustmentLayers: [
        {
            id: 'layer-1',
            name: 'Glue Bus',
            effectType: 'compressor',
            parameters: [],
            affectedTrackIds: ['track-bus'],
            insertionIndex: 0,
            regions: [],
            enabled: true,
            mix: 1,
            color: '#fff',
        },
    ],
    tracks: [
        {
            id: 'track-kick',
            name: 'Kick',
            kind: 'audio',
            canonicalRole: { role: 'kick', source: 'derived', evidence: 'chain' },
            muted: false,
            frozen: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 3,
            deviceCount: 1,
            clips: [
                { id: 'clip-kick-verse', name: 'Kick Verse', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 },
                { id: 'clip-kick-chorus', name: 'Kick Chorus', type: 'audio', startBeat: 8, endBeat: 16, noteCount: 0 },
                { id: 'clip-kick-outro', name: 'Kick Outro', type: 'audio', startBeat: 16, endBeat: 20, noteCount: 0 },
            ],
            devices: [{ id: 'device-kick-eq', name: 'Kick EQ', type: 'builtin-eq', bypassed: false }],
        },
        {
            id: 'track-snare',
            name: 'Snare',
            kind: 'audio',
            canonicalRole: { role: 'snare', source: 'derived', evidence: 'chain' },
            muted: false,
            frozen: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
        {
            id: 'track-bass',
            name: 'Bass',
            kind: 'audio',
            canonicalRole: { role: 'bass', source: 'brief', evidence: 'production-brief' },
            muted: false,
            frozen: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
        {
            id: 'track-hat',
            name: 'Hat',
            kind: 'audio',
            muted: true,
            frozen: true,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 1,
            clips: [],
            devices: [
                { id: 'device-hat-comp', name: 'Hat Comp', type: 'builtin-sidechain-compressor', bypassed: true },
            ],
        },
        {
            id: 'track-vox',
            name: 'Lead Vox',
            kind: 'audio',
            // `getCanonicalTrackRole` (Project/useCases) resolves an authored production-brief role
            // before it ever consults name tags, and 'Doubler' (this fixture's own brief role for
            // this track, above) is not a member of `CANONICAL_TRACK_ROLES` — so the real derivation
            // is 'unknown', never 'lead vocal', regardless of this track's name.
            canonicalRole: { role: 'unknown', source: 'authored', evidence: 'unsupported-authored-role' },
            muted: false,
            frozen: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
        {
            id: 'track-bus',
            name: 'Group Bus',
            kind: 'bus',
            canonicalRole: { role: 'bus', source: 'derived', evidence: 'chain' },
            muted: false,
            frozen: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
        {
            id: 'track-bgv',
            name: 'Backing Vocals',
            kind: 'audio',
            // Carries no authored production-brief role, so `getCanonicalTrackRole` falls through to
            // name tags: 'Backing Vocals' matches the `backing vocal` pattern, the same value this
            // fixture asserts — a reachable state, unlike `track-vox` above.
            canonicalRole: { role: 'backing vocal', source: 'name-tags', evidence: 'name-tokens' },
            muted: false,
            frozen: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const plan = (targetIds: string[]) => ({
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Resolve a semantic set predicate selector.',
    constraints: [],
    scope: { targetIds, targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
});

/** Compiles one bounded semantic list item carrying a `match` selector, against the shared fixture context by default. */
function compileSelectorItem(input: {
    commandArguments?: Record<string, unknown>;
    commandName: string;
    condition?: { field: string; equals: boolean };
    context?: ProjectContext;
    entity: string;
    excludeIds?: string[];
    itemId?: string;
    match?: unknown;
    quantity?: unknown;
    revision?: string;
    targetArgument: string;
    where?: Record<string, string>;
}) {
    const itemId = input.itemId ?? 'select-item';
    const selector: Record<string, unknown> = {
        targetArgument: input.targetArgument,
        entity: input.entity,
        quantity: input.quantity ?? { unit: 'targets', exactly: 1 },
    };
    if (input.match !== undefined) {
        selector.match = input.match;
    }
    if (input.where !== undefined) {
        selector.where = input.where;
    }
    if (input.condition !== undefined) {
        selector.condition = input.condition;
    }
    if (input.excludeIds !== undefined) {
        selector.excludeIds = input.excludeIds;
    }
    return compileArbitraryCommandList({
        context: input.context ?? context,
        revision: input.revision ?? 'revision-predicates',
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: plan([]),
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: itemId,
                                name: input.commandName,
                                arguments: input.commandArguments ?? {},
                                selector,
                            },
                        ],
                    },
                },
            },
        ],
    });
}

describe('semantic command list set predicates', () => {
    it('resolves a roleFamily predicate with a maximum quantity across every matching track', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            quantity: { unit: 'targets', maximum: 5 },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-kick', 'track-snare'] }] },
        });
    });

    it('accepts a roleFamily predicate resolved exactly at its maximum quantity boundary', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            quantity: { unit: 'targets', maximum: 2 },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-kick', 'track-snare'] }] },
        });
    });

    it('resolves a role predicate against a canonical role authored through the production brief', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ role: 'bass' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-bass'] }] },
        });
    });

    it('resolves match.any as a union: either predicate holding admits the candidate', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { any: [{ role: 'kick' }, { isMuted: true }] },
            quantity: { unit: 'targets', maximum: 5 },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-kick', 'track-hat'] }] },
        });
    });

    it('resolves hasDeviceType against a bypassed device of the named type', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ hasDeviceType: 'builtin-sidechain-compressor' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-hat'] }] },
        });
    });

    it('resolves a tag predicate against a production-brief-authored role', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ tag: 'Doubler' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-vox'] }] },
        });
    });

    it('resolves a tag predicate against the owning track kind', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ tag: 'Bus' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-bus'] }] },
        });
    });

    it('resolves a kind predicate against the owning track kind exactly', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ kind: 'bus' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-bus'] }] },
        });
    });

    it('resolves an isFrozen predicate against the owning track frozen state, not its muted state', () => {
        // track-hat is muted AND frozen in the shared fixture, so isFrozen would pass even reading
        // the muted field by mistake. Discriminate frozen from muted with a track that is frozen
        // only.
        const mutatedContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-hat' ? { ...track, muted: false, frozen: true } : track
            ),
        };
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ isFrozen: true }] },
            context: mutatedContext,
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-hat'] }] },
        });
    });

    it('resolves an isMuted predicate on a clip entity against the owning track state, not the clip own muted field', () => {
        const mutedTrackClipId = 'clip-hat-unmuted-own';
        const mutatedContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) => {
                if (track.id === 'track-hat') {
                    return {
                        ...track,
                        clips: [
                            {
                                id: mutedTrackClipId,
                                name: 'Hat Clip',
                                type: 'audio',
                                startBeat: 0,
                                endBeat: 4,
                                noteCount: 0,
                                muted: false,
                            },
                        ],
                    };
                }
                if (track.id === 'track-kick') {
                    return {
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-kick-verse' ? { ...clip, muted: true } : clip
                        ),
                    };
                }
                return track;
            }),
        };
        const result = compileSelectorItem({
            itemId: 'clip-owner-muted',
            commandName: 'duplicateClip',
            entity: 'clip',
            targetArgument: 'clipId',
            match: { all: [{ isMuted: true }] },
            context: mutatedContext,
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: [mutedTrackClipId] }] },
        });
    });

    it('resolves an isFrozen predicate on a device entity against the owning track state, not its muted state', () => {
        // Same discrimination as the track-level isFrozen case, applied to a device whose owning
        // track is frozen only — an owner-muted read would pass this row too if left undiscriminated.
        const mutatedContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-hat' ? { ...track, muted: false, frozen: true } : track
            ),
        };
        const result = compileSelectorItem({
            itemId: 'device-owner-frozen',
            commandName: 'bypassDevice',
            commandArguments: { bypassed: true },
            entity: 'device',
            targetArgument: 'deviceId',
            match: { all: [{ isFrozen: true }] },
            context: mutatedContext,
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['device-hat-comp'] }] },
        });
    });

    it('resolves inSection on a clip to only the clip whose span overlaps, excluding clips touching either boundary', () => {
        const result = compileSelectorItem({
            commandName: 'duplicateClip',
            entity: 'clip',
            targetArgument: 'clipId',
            match: { all: [{ inSection: 'section-chorus' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['clip-kick-chorus'] }] },
        });
    });

    it('resolves inSection on a track to a track with any overlapping clip, unlike the per-clip semantics', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ inSection: 'section-chorus' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-kick'] }] },
        });
    });

    it('resolves a device candidate through its owning track facts', () => {
        const result = compileSelectorItem({
            commandName: 'bypassDevice',
            commandArguments: { bypassed: true },
            entity: 'device',
            targetArgument: 'deviceId',
            match: { all: [{ roleFamily: 'drums' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['device-kick-eq'] }] },
        });
    });

    it('resolves nameIncludes case-insensitively against the candidate own name', () => {
        const result = compileSelectorItem({
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ nameIncludes: 'VOX' }] },
        });
        expect(result).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-vox'] }] },
        });
    });

    it('rejects with ambiguous-target and exact counts when resolution exceeds the maximum', () => {
        const result = compileSelectorItem({
            itemId: 'maximum-exceeded',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            quantity: { unit: 'targets', maximum: 1 },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector maximum-exceeded resolved 2 targets, more than its maximum of 1.',
            detail: {
                kind: 'ambiguous-target',
                itemId: 'maximum-exceeded',
                entity: 'track',
                resolvedCount: 2,
                expectedCount: 1,
                candidateIds: ['track-kick', 'track-snare'],
            },
        });
    });

    it('rejects a maximum quantity with zero resolved candidates', () => {
        const result = compileSelectorItem({
            itemId: 'maximum-zero',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'guitar' }] },
            quantity: { unit: 'targets', maximum: 3 },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector maximum-zero resolved 0 targets; its match named no target.',
            detail: {
                kind: 'missing-target',
                itemId: 'maximum-zero',
                entity: 'track',
                resolvedCount: 0,
                expectedCount: 3,
                candidateIds: [],
            },
        });
    });

    it.each([
        { label: 'zero', predicate: {} },
        { label: 'two', predicate: { role: 'kick', kind: 'audio' } },
    ])('rejects a predicate naming $label fields', ({ predicate }) => {
        const result = compileSelectorItem({
            itemId: 'predicate-key-check',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [predicate] },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command list item predicate-key-check match predicate must name exactly one field.',
        });
    });

    it('rejects an unknown role, naming the offending value', () => {
        const result = compileSelectorItem({
            itemId: 'unknown-role',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ role: 'trombone' }] },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector unknown-role match predicate names an unknown role: trombone',
        });
    });

    it('rejects an unknown roleFamily at the schema boundary', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-predicates',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan([]),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'unknown-role-family',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        match: { all: [{ roleFamily: 'strings' }] },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        });
    });

    it('rejects an unknown section, naming the offending value', () => {
        const result = compileSelectorItem({
            itemId: 'unknown-section',
            commandName: 'duplicateClip',
            entity: 'clip',
            targetArgument: 'clipId',
            match: { all: [{ inSection: 'section-bridge' }] },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector unknown-section match predicate names an unknown section: section-bridge',
        });
    });

    it('rejects inSection on a device entity', () => {
        const result = compileSelectorItem({
            itemId: 'in-section-device',
            commandName: 'bypassDevice',
            commandArguments: { bypassed: true },
            entity: 'device',
            targetArgument: 'deviceId',
            match: { all: [{ inSection: 'section-chorus' }] },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector in-section-device match may not use inSection with entity device.',
        });
    });

    it('rejects inSection on an automation-lane entity', () => {
        const result = compileSelectorItem({
            itemId: 'in-section-lane',
            commandName: 'setAutomationLaneEnabled',
            commandArguments: { enabled: true },
            entity: 'automation-lane',
            targetArgument: 'laneId',
            match: { all: [{ inSection: 'section-chorus' }] },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector in-section-lane match may not use inSection with entity automation-lane.',
        });
    });

    it('rejects match on an adjustment-layer entity', () => {
        const result = compileSelectorItem({
            itemId: 'match-adjustment-layer',
            commandName: 'addAdjustmentRegion',
            commandArguments: { startBeat: 0, endBeat: 4, blend: 0.5, fadeInBeats: 0, fadeOutBeats: 0 },
            entity: 'adjustment-layer',
            targetArgument: 'layerId',
            match: { all: [{ kind: 'anything' }] },
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Bulk selector match-adjustment-layer match may not target an adjustment-layer entity.',
        });
    });

    it('rejects an empty match with no predicate group', () => {
        const result = compileSelectorItem({
            itemId: 'empty-match',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: {},
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command list item empty-match match must name a non-empty predicate group.',
        });
    });

    it.each([
        { label: 'both', quantity: { unit: 'targets', exactly: 1, maximum: 2 } },
        { label: 'neither', quantity: { unit: 'targets' } },
    ])('rejects a quantity naming $label of exactly/maximum', ({ quantity }) => {
        const result = compileSelectorItem({
            itemId: 'quantity-check',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ role: 'kick' }] },
            quantity,
        });
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command list item quantity-check quantity must name exactly one of exactly or maximum.',
        });
    });

    it('rejects stale evidence once the owning track no longer satisfies the compiled predicate', () => {
        const compiled = compileSelectorItem({
            itemId: 'stale-precondition',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            quantity: { unit: 'targets', maximum: 5 },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error('expected the fixture selector to compile');
        }
        const mutatedContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) => {
                if (track.id !== 'track-kick') {
                    return track;
                }
                return { ...track, canonicalRole: { role: 'bass', source: 'derived', evidence: 'chain' } };
            }),
        };
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context: mutatedContext,
                revision: 'revision-predicates',
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command compiler evidence preconditions no longer hold.',
        });
    });

    it('rejects stale evidence once a track the compiled predicate never saw begins matching, leaving every already-resolved candidate unchanged', () => {
        const compiled = compileSelectorItem({
            itemId: 'stale-new-match',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            quantity: { unit: 'targets', maximum: 5 },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error('expected the fixture selector to compile');
        }
        const mutatedContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) => {
                if (track.id !== 'track-hat') {
                    return track;
                }
                return { ...track, canonicalRole: { role: 'hi-hat', source: 'derived', evidence: 'chain' } };
            }),
        };
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context: mutatedContext,
                revision: 'revision-predicates',
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command compiler evidence preconditions no longer hold.',
        });
    });

    it('accepts a full compile-then-validate round trip for a match selector against an unchanged context', () => {
        const compiled = compileSelectorItem({
            itemId: 'round-trip',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'vocal' }] },
        });
        expect(compiled).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-bgv'] }] },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error('expected the fixture selector to compile');
        }
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context,
                revision: 'revision-predicates',
            })
        ).toMatchObject({
            status: 'accepted',
            targetOverridesByCallIndex: new Map([
                [0, [{ argument: 'trackId', capability: 'track', cardinality: 'one', stableIds: ['track-bgv'] }]],
            ]),
        });
    });

    it('accepts a compile-then-validate round trip for a match selector combined with excludeIds', () => {
        const compiled = compileSelectorItem({
            itemId: 'round-trip-exclude-ids',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            excludeIds: ['track-snare'],
        });
        expect(compiled).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-kick'] }] },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error('expected the fixture selector to compile');
        }
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context,
                revision: 'revision-predicates',
            })
        ).toMatchObject({
            status: 'accepted',
            targetOverridesByCallIndex: new Map([
                [0, [{ argument: 'trackId', capability: 'track', cardinality: 'one', stableIds: ['track-kick'] }]],
            ]),
        });
    });

    it('accepts a compile-then-validate round trip for a match selector combined with a condition', () => {
        const compiled = compileSelectorItem({
            itemId: 'round-trip-condition',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ kind: 'audio' }] },
            condition: { field: 'muted', equals: true },
        });
        expect(compiled).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-hat'] }] },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error('expected the fixture selector to compile');
        }
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context,
                revision: 'revision-predicates',
            })
        ).toMatchObject({
            status: 'accepted',
            targetOverridesByCallIndex: new Map([
                [0, [{ argument: 'trackId', capability: 'track', cardinality: 'one', stableIds: ['track-hat'] }]],
            ]),
        });
    });

    it('accepts a compile-then-validate round trip for a match selector combined with where', () => {
        const compiled = compileSelectorItem({
            itemId: 'round-trip-where',
            commandName: 'muteTrack',
            commandArguments: { muted: true },
            entity: 'track',
            targetArgument: 'trackId',
            match: { all: [{ roleFamily: 'drums' }] },
            where: { name: 'Kick' },
        });
        expect(compiled).toMatchObject({
            status: 'accepted',
            compilerEvidence: { selectors: [{ stableIds: ['track-kick'] }] },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            throw new Error('expected the fixture selector to compile');
        }
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context,
                revision: 'revision-predicates',
            })
        ).toMatchObject({
            status: 'accepted',
            targetOverridesByCallIndex: new Map([
                [0, [{ argument: 'trackId', capability: 'track', cardinality: 'one', stableIds: ['track-kick'] }]],
            ]),
        });
    });

    it('keeps every role-family table value inside the mix recipe catalog roles', () => {
        const catalog = getMixRecipeCatalog();
        const familyValues = Object.values(CANONICAL_ROLE_TO_RECIPE_ROLE).filter(
            (value): value is SemanticCommandListRoleFamily => value !== null
        );
        expect(familyValues.length).toBeGreaterThan(0);
        for (const family of familyValues) {
            expect(catalog.roles).toContain(family);
        }
    });
});
