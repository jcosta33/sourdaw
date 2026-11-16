import { describe, expect, it } from 'vitest';

import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { isExecutableAppActionType } from '../executableAppActionRegistry';
import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { requiresAppActionConfirmation } from '../requiresAppActionConfirmation';

describe('app action execution policy', () => {
    it.each([
        'armTrack',
        'toggleRecording',
        'setTempo',
        'setMasterGain',
        'stopPlayback',
        'setTrackOutput',
        'setSend',
        'addSend',
        'removeSend',
        'addSidechainRoute',
        'removeSidechainRoute',
        'setPunchIn',
        'setPunchOut',
        'setPunchEnabled',
    ] as const)('requires confirmation for a single authority-sensitive %s action', (type) => {
        expect(requiresAppActionConfirmation([{ type }])).toBe(true);
    });

    it.each(['removeTrack', 'removeAllTracks', 'removeClip', 'removeDevice', 'bounceInPlace'] as const)(
        'requires confirmation for a single destructive %s action',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(true);
        }
    );

    it.each(['duplicateTrack', 'clearSolos'] as const)(
        'requires confirmation for a single broad reversible %s action',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(true);
        }
    );

    it('requires confirmation for a multi-action batch even when every action is bounded', () => {
        expect(requiresAppActionConfirmation([{ type: 'muteTrack' }, { type: 'setTrackGain' }])).toBe(true);
    });

    it.each(['renameTrack', 'muteTrack', 'setTrackGain'] as const)(
        'allows a single bounded %s action without confirmation',
        (type) => {
            expect(requiresAppActionConfirmation([{ type }])).toBe(false);
        }
    );

    it('does not require confirmation for an empty batch', () => {
        expect(requiresAppActionConfirmation([])).toBe(false);
    });

    it('fails closed for an unclassified action type', () => {
        expect(getAppActionExecutionPolicy('futureAction')).toEqual({
            classification: 'default',
            risk: 'unclassified',
            requiresConfirmation: true,
            reason: 'This action has no explicit execution policy and must be reviewed.',
        });
    });

    it('yields the pinned policy for every listed action and the default for the rest', () => {
        const listedBy: Record<string, string[]> = {
            readOnlyPolicy: ['analyzeMix', 'copyClip', 'detectKey', 'detectTempo', 'getLatencyReport'],
            boundedPolicy: [
                'addAutomationLane',
                'addDevice',
                'applyGroove',
                'arpeggiate',
                'closeMixer',
                'createFolder',
                'disableMpe',
                'disableTrack',
                'duplicateClip',
                'duplicateClipToNextBar',
                'enableMpe',
                'extractGroove',
                'fitClipToBeats',
                'foldTrack',
                'hideTrack',
                'humanizeNotes',
                'invertNotes',
                'lockClip',
                'muteClip',
                'nudgeClip',
                'openMixer',
                'openPreferencesDialog',
                'pasteClip',
                'quantizeNoteLengths',
                'quantizeNotes',
                'renameClip',
                'retrogradeNotes',
                'scaleVelocities',
                'setAllVelocities',
                'setClipLoop',
                'setClipLoopLength',
                'setClipStretchMode',
                'setClipStretchRatio',
                'setSoloSafe',
                'setWorkspaceMode',
                'stopPlayback',
                'toggleChatPanel',
                'toggleCountIn',
                'toggleInspector',
                'toggleLoop',
                'toggleMetronome',
                'togglePlayback',
                'togglePreRoll',
                'togglePunch',
                'toggleSidebar',
                'toggleSoloSafe',
                'transposeNotes',
                'zoomToFit',
                'zoomToSelection',
            ],
            broadPolicy: [
                'copyMidiArticulations',
                'removeShortMidiOverlaps',
                'audioToMidi',
                'autoFixMix',
                'bounceToNewTrack',
                'clearSolos',
                'restoreSoloSafe',
                'restoreTrackSoloStates',
                'consolidateAllTracks',
                'freezeTrack',
                'generateChordProgression',
                'generateDrumPattern',
                'generateMelody',
                'redo',
                'undo',
                'unfreezeTrack',
            ],
            destructivePolicy: [
                'bounceInPlace',
                'cutClip',
                'normalizeClip',
                'removeAllTracks',
                'removeClip',
                'removeDevice',
                'removeTrack',
                'reverseClip',
                'stripSilence',
                'quantizeTransients',
            ],
            authoritySensitivePolicy: ['armTrack', 'setMasterGain', 'toggleRecording'],
            externalEffectPolicy: ['createCollabSession', 'joinCollabSession', 'scanPlugins'],
        };
        const riskByType = new Map<string, string>();
        for (const [policy, types] of Object.entries(listedBy)) {
            for (const type of types) {
                riskByType.set(type, policy);
            }
        }
        const policyForName = new Map<string, readonly [string, boolean]>([
            ['readOnlyPolicy', ['read-only', false]],
            ['boundedPolicy', ['bounded-reversible', false]],
            ['broadPolicy', ['broad-reversible', true]],
            ['destructivePolicy', ['destructive-reversible', true]],
            ['authoritySensitivePolicy', ['authority-sensitive', true]],
            ['externalEffectPolicy', ['external-effect', true]],
        ]);
        const unclassified = getAppActionExecutionPolicy('futureAction');
        const tableTypes = Object.keys(undoEntryStoresCommandIdByActionType).filter(
            (type) => !isExecutableAppActionType(type)
        );

        expect(tableTypes.length).toBeGreaterThan(0);
        for (const type of tableTypes) {
            const expected = policyForName.get(riskByType.get(type) ?? '');
            const actual = getAppActionExecutionPolicy(type);
            if (expected === undefined) {
                expect(actual).toBe(unclassified);
                continue;
            }
            const [risk, requiresConfirmation] = expected;
            expect(actual).toMatchObject({ classification: 'explicit', risk, requiresConfirmation });
        }
    });

    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
        'treats the inherited name %s as unclassified',
        (name) => {
            expect(getAppActionExecutionPolicy(name)).toEqual({
                classification: 'default',
                risk: 'unclassified',
                requiresConfirmation: true,
                reason: 'This action has no explicit execution policy and must be reviewed.',
            });
        }
    );
});
