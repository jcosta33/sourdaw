import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { resolveSemanticCommandListSelector } from '../../services/semanticCommandListCandidates';
import { getBulkDeviceInsertionTrackScope } from '../agentReference/getBulkDeviceInsertionTrackScope';
import { getDrumRoutingPromptScope } from '../agentReference/getDrumRoutingPromptScope';
import { getWholeProjectVibeMixScope } from '../agentReference/getWholeProjectVibeMixScope';

vi.mock('../../services/semanticCommandListCandidates', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../services/semanticCommandListCandidates')>();
    return { ...original, resolveSemanticCommandListSelector: vi.fn(original.resolveSemanticCommandListSelector) };
});

const resolverSpy = vi.mocked(resolveSemanticCommandListSelector);

const resolverFoundNothing = { status: 'rejected', reason: 'forced for the test' } as const;

type CanonicalRole = NonNullable<ProjectContextTrack['canonicalRole']>;

const nameDerived = (role: string): CanonicalRole => ({ role, source: 'name-tags', evidence: 'name-tokens' });
const userSet = (role: string): CanonicalRole => ({ role, source: 'authored', evidence: 'authored-role' });

function createTrack(id: string, name: string, overrides: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
        sends: [],
        ...overrides,
    };
}

function createContext(tracks: ProjectContextTrack[], overrides: Partial<ProjectContext> = {}): ProjectContext {
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
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
        ...overrides,
    };
}

function resolvedSelectorsMatching(entity: 'track', match: unknown) {
    return resolverSpy.mock.calls.filter(
        ([input]) => input.selector.entity === entity && JSON.stringify(input.selector.match) === JSON.stringify(match)
    );
}

beforeEach(() => {
    resolverSpy.mockClear();
});

afterEach(() => {
    resolverSpy.mockReset();
});

describe('bulk device insertion scope', () => {
    const context = createContext([
        createTrack('track-bass-di', 'Bass DI'),
        createTrack('track-bass-frozen', 'Bass Frozen', { frozen: true }),
        createTrack('track-guitar', 'Guitar'),
    ]);

    it('takes its unfrozen targets and its frozen exclusions from the shared selector resolver', () => {
        const scope = getBulkDeviceInsertionTrackScope('Add EQ to every bass track', context);

        expect(scope).toEqual({
            targetIds: ['track-bass-di'],
            anchors: [],
            excludedFrozenTrackIds: ['track-bass-frozen'],
        });
        expect(
            resolvedSelectorsMatching('track', { all: [{ nameIncludes: 'bass' }, { isFrozen: false }] })
        ).toHaveLength(1);
        expect(
            resolvedSelectorsMatching('track', { all: [{ nameIncludes: 'bass' }, { isFrozen: true }] })
        ).toHaveLength(1);
    });

    it('claims no scope when the shared resolver names no track', () => {
        resolverSpy.mockReturnValue(resolverFoundNothing);

        expect(getBulkDeviceInsertionTrackScope('Add EQ to every bass track', context)).toBeNull();
    });

    it('keeps a name that only contains the family out of the scope', () => {
        const withBassoon = createContext([...context.tracks, createTrack('track-bassoon', 'Bassoon')]);

        expect(getBulkDeviceInsertionTrackScope('Add EQ to every bass track', withBassoon)?.targetIds).toEqual([
            'track-bass-di',
        ]);
    });
});

describe('drum routing scope', () => {
    const bus = createTrack('bus-drums', 'Drum Bus', { kind: 'bus', canonicalRole: nameDerived('bus') });
    const parallelReturn = createTrack('track-parallel', 'Parallel Compression Return', {
        kind: 'bus',
        canonicalRole: nameDerived('unknown'),
    });

    function createDrumContext(tracks: ProjectContextTrack[]): ProjectContext {
        return createContext([bus, parallelReturn, ...tracks]);
    }

    it('joins a track the user set to kick in the inspector and protects a Snare the user set to fx', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-thing', 'Thing 3', { canonicalRole: userSet('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: userSet('fx') }),
                createTrack('track-bass', 'Bass DI', { canonicalRole: nameDerived('bass') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick', 'track-thing']);
        expect(scope.capability?.candidateDrums).toContainEqual(
            expect.objectContaining({
                id: 'track-thing',
                role: 'kick',
                roleEvidence: 'canonical-role:kick:authored',
            })
        );
        expect(scope.capability?.protectedNonDrums).toContainEqual(
            expect.objectContaining({
                id: 'track-snare',
                role: 'fx',
                roleEvidence: 'canonical-role:fx:authored',
            })
        );
        expect(scope.capability?.allowedAction.forbiddenTargetIds).toContain('track-snare');
        expect(resolvedSelectorsMatching('track', { all: [{ roleFamily: 'drums' }] })).toHaveLength(1);
    });

    it('protects a Drums folder above the kit and still routes the kit', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('folder-drums', 'Drums', { kind: 'folder', canonicalRole: nameDerived('drums') }),
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: nameDerived('snare') }),
                createTrack('track-oh', 'OH', { canonicalRole: nameDerived('overhead') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick', 'track-snare', 'track-oh']);
        expect(scope.capability?.protectedNonDrums).toContainEqual(
            expect.objectContaining({ id: 'folder-drums', role: 'structural' })
        );
    });

    it('protects a bus carrying an authored kick role and still routes the kit', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('bus-aux', 'Aux 1', { kind: 'bus', canonicalRole: userSet('kick') }),
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: nameDerived('snare') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick', 'track-snare']);
        expect(scope.capability?.protectedNonDrums).toContainEqual(
            expect.objectContaining({ id: 'bus-aux', role: 'structural' })
        );
    });

    it('labels a drum-named track by the drum role the user authored for it', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([createTrack('track-kick', 'Kick', { canonicalRole: userSet('snare') })]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.capability?.candidateDrums).toContainEqual(
            expect.objectContaining({
                id: 'track-kick',
                role: 'snare',
                roleEvidence: 'canonical-role:snare:authored',
            })
        );
    });

    it('routes an overhead and a drum room by their canonical roles, with no name fallback', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-oh', 'OH', { canonicalRole: nameDerived('overhead') }),
                createTrack('track-room', 'Drum Room', { canonicalRole: nameDerived('room') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-oh', 'track-room']);
        expect(scope.capability?.candidateDrums).toEqual([
            expect.objectContaining({
                id: 'track-oh',
                role: 'overhead',
                roleEvidence: 'canonical-role:overhead:name-tags',
            }),
            expect.objectContaining({
                id: 'track-room',
                role: 'room',
                roleEvidence: 'canonical-role:room:name-tags',
            }),
        ]);
    });

    it('protects utility and orchestral tracks and routes the kit around them', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-click', 'Click', { canonicalRole: nameDerived('utility') }),
                createTrack('track-hat-trick', 'Hat Trick', { canonicalRole: nameDerived('utility') }),
                createTrack('track-strings', 'Strings', { canonicalRole: nameDerived('strings') }),
            ]),
            'rev-1'
        );

        if (scope.status !== 'request') {
            throw new Error(`Expected a drum routing request, got ${scope.status}`);
        }
        expect(scope.targetIds).toEqual(['track-kick']);
        expect(scope.capability?.protectedNonDrums).toEqual([
            expect.objectContaining({ id: 'track-click', role: 'utility' }),
            expect.objectContaining({ id: 'track-hat-trick', role: 'utility' }),
            expect.objectContaining({ id: 'track-strings', role: 'strings' }),
        ]);
    });

    it('refuses the scope for a track whose canonical role is unknown, whatever its name says', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-oh', 'OH', { canonicalRole: nameDerived('unknown') }),
            ])
        );

        expect(scope).toEqual({ status: 'invalid', reason: 'MF-01 track role is ambiguous: track-oh' });
    });

    it('still refuses the whole scope for a frozen drum instead of dropping it', () => {
        const scope = getDrumRoutingPromptScope(
            createDrumContext([
                createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') }),
                createTrack('track-snare', 'Snare', { canonicalRole: nameDerived('snare'), frozen: true }),
            ])
        );

        expect(scope).toEqual({
            status: 'invalid',
            reason: 'MF-01 drum target is protected or locked: track-snare',
        });
    });

    it('finds its drums only through the shared resolver once every track carries a canonical role', () => {
        resolverSpy.mockReturnValue(resolverFoundNothing);

        expect(
            getDrumRoutingPromptScope(
                createDrumContext([createTrack('track-kick', 'Kick', { canonicalRole: nameDerived('kick') })])
            )
        ).toEqual({ status: 'invalid', reason: 'MF-01 found no unambiguous drum tracks' });
    });
});

describe('whole-project vibe-mix scope', () => {
    const context = createContext(
        [
            createTrack('bus-drums', 'Drum Bus', { kind: 'bus' }),
            createTrack('bus-bass', 'Bass Bus', { kind: 'bus' }),
            createTrack('track-vocal', 'Lead Vocal'),
            createTrack('master', 'Master', { kind: 'master' }),
        ],
        {
            sections: [
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 0, endBeat: 8 },
                { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 8, endBeat: 16 },
            ],
        }
    );

    it('discovers the drum and bass impact buses through the shared selector resolver', () => {
        expect(getWholeProjectVibeMixScope(context)?.targetIds).toEqual(['bus-drums', 'bus-bass']);
        expect(
            resolvedSelectorsMatching('track', {
                all: [{ kind: 'bus' }, { nameIncludes: 'drum' }, { nameIncludes: 'bus' }],
            })
        ).toHaveLength(1);
        expect(
            resolvedSelectorsMatching('track', {
                all: [{ kind: 'bus' }, { nameIncludes: 'bass' }, { nameIncludes: 'bus' }],
            })
        ).toHaveLength(1);
    });

    it('claims no scope when the shared resolver names no bus', () => {
        resolverSpy.mockReturnValue(resolverFoundNothing);

        expect(getWholeProjectVibeMixScope(context)).toBeNull();
    });

    it('refuses two buses that both name the role', () => {
        const withSecondDrumBus = createContext(
            [...context.tracks, createTrack('bus-drums-two', 'Drum Bus 2', { kind: 'bus' })],
            {
                sections: context.sections,
            }
        );

        expect(getWholeProjectVibeMixScope(withSecondDrumBus)).toBeNull();
    });
});
