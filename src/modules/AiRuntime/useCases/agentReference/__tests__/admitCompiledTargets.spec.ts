import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import {
    createCompiledTargetAdmission,
    type CompiledSelectorTerms,
    type CompiledTargetAuthority,
    type CompiledTargetCallTerms,
} from '../admitCompiledTargets';

function createTrack(id: string, name: string, overrides: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: overrides.devices?.length ?? 0,
        clips: [],
        devices: [],
        ...overrides,
    };
}

function createProjectContext(tracks: ProjectContextTrack[]): ProjectContext {
    return {
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
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

function createAdmission(prompt: string) {
    return createCompiledTargetAdmission({
        catalog: getExecutableAppActionGroundingCatalog(),
        compilerExcludedIds: new Set(),
        prompt,
        valueTexts: [],
    });
}

const ADMITTED: CompiledTargetAuthority = { status: 'admitted' };
const PROTECTED: CompiledTargetAuthority = { status: 'refused', reason: 'protected-or-excluded' };
const UNAUTHORIZED: CompiledTargetAuthority = { status: 'refused', reason: 'unauthorized' };

/**
 * Admits the calls in order through one batch admission, and each alone through a fresh one: a call
 * reusing a reading taken for other terms answers what the request said about those terms instead.
 */
function admitInOneBatch(prompt: string, calls: readonly CompiledTargetCallTerms[]) {
    const batch = createAdmission(prompt);
    return calls.map((call) => ({ batch: batch(call), fresh: createAdmission(prompt)(call) }));
}

const MUTE_PROMPT = 'Mute every track; leave Bass alone';

/** Bass protected by name, beside the same project once that track is called Synth. */
const namedBass = createProjectContext([createTrack('track-bass', 'Bass'), createTrack('track-keys', 'Keys')]);
const renamedBass = createProjectContext([createTrack('track-bass', 'Synth'), createTrack('track-keys', 'Keys')]);

function muteTerms(context: ProjectContext, targetId: string): CompiledTargetCallTerms {
    return { argument: 'trackId', capability: 'track', context, referenceResolved: true, targetIds: [targetId] };
}

describe('compiled target admission across one batch', () => {
    it('reads the request against the project each call names, never one an earlier call read', () => {
        const admission = createAdmission(MUTE_PROMPT);

        expect(admission(muteTerms(namedBass, 'track-bass'))).toEqual(PROTECTED);
        expect(admission(muteTerms(renamedBass, 'track-bass'))).toEqual(ADMITTED);
        expect(createAdmission(MUTE_PROMPT)(muteTerms(renamedBass, 'track-bass'))).toEqual(ADMITTED);
    });

    it('checks each call of one reading against its own targets', () => {
        const admission = createAdmission(MUTE_PROMPT);

        expect(admission(muteTerms(namedBass, 'track-keys'))).toEqual(ADMITTED);
        expect(admission(muteTerms(namedBass, 'track-bass'))).toEqual(PROTECTED);
    });

    it("reads a selector's name picks for the argument it resolves, never for another argument of its call", () => {
        // The selector picks tracks by "Guitar", which the request never states; it resolves only `trackId`.
        const guitarTracks: CompiledSelectorTerms = {
            targetArgument: 'trackId',
            match: { all: [{ nameIncludes: 'Guitar' }] },
        };
        const context = createProjectContext([
            createTrack('track-guitar-1', 'Guitar 1'),
            createTrack('bus-guitar', 'Guitar Bus', { kind: 'bus' }),
        ]);
        const call = (argument: string, targetId: string): CompiledTargetCallTerms => ({
            argument,
            capability: 'track',
            context,
            referenceResolved: false,
            selectorTerms: guitarTracks,
            targetIds: [targetId],
        });

        const verdicts = admitInOneBatch('Send every track to the bus', [
            call('trackId', 'track-guitar-1'),
            call('busId', 'bus-guitar'),
        ]);

        expect(verdicts).toEqual([
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
            { batch: ADMITTED, fresh: ADMITTED },
        ]);
    });

    it('reads a restriction against the owner track each call names, never one an earlier call named', () => {
        const eqTrack = (id: string, name: string) =>
            createTrack(id, name, {
                devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
            });
        const context = createProjectContext([
            eqTrack('track-vocals', 'Vocals'),
            eqTrack('track-keys', 'Keys'),
            eqTrack('track-bass', 'Bass'),
        ]);
        const call = (trackId: string): CompiledTargetCallTerms => ({
            argument: 'deviceId',
            capability: 'device',
            context,
            dependencyId: trackId,
            referenceResolved: true,
            targetIds: [`${trackId}-eq`],
        });
        const prompt = 'Bypass the EQ on every track; leave the EQ on Keys alone';

        expect(admitInOneBatch(prompt, [call('track-keys'), call('track-bass')])).toEqual([
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
            { batch: ADMITTED, fresh: ADMITTED },
        ]);
        expect(admitInOneBatch(prompt, [call('track-vocals'), call('track-keys')])).toEqual([
            { batch: ADMITTED, fresh: ADMITTED },
            { batch: UNAUTHORIZED, fresh: UNAUTHORIZED },
        ]);
    });
});
