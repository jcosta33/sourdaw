import { describe, expect, it } from 'vitest';

import { type CreativeRequestAuthority } from '../../models/CreativeInterpretation';
import { type ProjectContext } from '../../models/ProjectContext';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

const REVISION = 'revision-creative-evidence';
const MISMATCH_REASON = 'Structured command compiler evidence does not match the admitted creative authority.';

const context: ProjectContext = {
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
    tracks: [
        {
            id: 'track-bass',
            name: 'Bass',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
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

const authority: CreativeRequestAuthority = {
    schemaVersion: 1,
    authorityId: 'creative-authority-admitted',
    catalogId: 'creative-catalog-1',
    requestDigest: 'digest-1',
    revision: REVISION,
    selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
    mode: 'edit',
    targets: [
        { provenance: 'explicit-reference', objectType: 'track', objectIds: ['track-bass'], parentTrackId: null },
    ],
    editDimensions: ['processing'],
    prohibitions: [],
    creationSlots: [],
    uncertainty: 'none',
};

const proposalCall = {
    id: 'propose-1',
    name: 'command.batch.propose',
    arguments: {
        plan: {
            semantic: { classification: 'complex', uncertainty: [] },
            objective: 'Sit the bass further back.',
            constraints: [],
            scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            capabilityIds: [],
            assetIds: [],
            alternatives: [],
            validationStrategy: [],
            stoppingConditions: [],
        },
        list: {
            schemaVersion: 1,
            items: [
                {
                    id: 'gain-1',
                    name: 'setTrackGain',
                    arguments: { gain: 0.5 },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { name: 'Bass' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ],
        },
    },
};

function compileUnder(creativeAuthority: CreativeRequestAuthority | undefined) {
    const compiled = compileArbitraryCommandList({
        calls: [proposalCall],
        context,
        revision: REVISION,
        ...(creativeAuthority === undefined ? {} : { creativeAuthority }),
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(
            `Fixture must compile to evidence: ${compiled.status === 'rejected' ? compiled.reason : 'no evidence'}`
        );
    }
    return compiled.compilerEvidence;
}

describe('validateArbitraryCommandListEvidence creative authority binding', () => {
    it('refuses a batch compiled under an authority the replay no longer carries', () => {
        const evidence = compileUnder(authority);

        expect(evidence.creativeAuthorityId).toBe('creative-authority-admitted');
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence,
                calls: evidence.commands,
                context,
                revision: REVISION,
            })
        ).toEqual({ status: 'rejected', reason: MISMATCH_REASON });
    });

    it('refuses a batch replayed under a different admitted authority', () => {
        const evidence = compileUnder(authority);

        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: { ...authority, authorityId: 'creative-authority-other' },
                evidence,
                calls: evidence.commands,
                context,
                revision: REVISION,
            })
        ).toMatchObject({ status: 'rejected', reason: MISMATCH_REASON });
    });

    it('refuses an authority minted against a different project snapshot', () => {
        const evidence = compileUnder(authority);

        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: { ...authority, revision: 'revision-somewhere-else' },
                evidence,
                calls: evidence.commands,
                context,
                revision: REVISION,
            })
        ).toMatchObject({ status: 'rejected', reason: MISMATCH_REASON });
    });

    it('accepts a batch replayed under the same authority and snapshot it was compiled under', () => {
        const evidence = compileUnder(authority);

        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: authority,
                evidence,
                calls: evidence.commands,
                context,
                revision: REVISION,
            })
        ).toMatchObject({ status: 'accepted' });
    });

    it('accepts an ordinary batch that no interpretation ever claimed', () => {
        const evidence = compileUnder(undefined);

        expect(evidence.creativeAuthorityId).toBe(null);
        expect(
            validateArbitraryCommandListEvidence({
                creativeAuthority: undefined,
                evidence,
                calls: evidence.commands,
                context,
                revision: REVISION,
            })
        ).toMatchObject({ status: 'accepted' });
    });
});
