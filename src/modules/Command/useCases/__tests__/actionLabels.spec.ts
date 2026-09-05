import { describe, it, expect, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { describeAction, ACTION_LABELS } from '../actionLabels';

// The real store carries the shipped default bindings; the derivation below
// must never observe a mock, so it reaches for the actual module.
const realShortcutStores = await vi.importActual<typeof import('#/modules/CommandInterface/stores')>(
    '#/modules/CommandInterface/stores'
);

describe('ACTION_LABELS', () => {
    it('contains labels for core action types', () => {
        expect(ACTION_LABELS.addTrack).toBe('Add track');
        expect(ACTION_LABELS.togglePlayback).toBe('Play/pause');
        expect(ACTION_LABELS.undo).toBe('Undo');
        // #3623 — cutClip refusals describe through this map; a missing entry
        // surfaces the raw action token in the user-facing warning.
        expect(ACTION_LABELS.cutClip).toBe('Cut clip');
        expect(ACTION_LABELS.copyClip).toBe('Copy clip');
        expect(ACTION_LABELS.pasteClip).toBe('Paste clip');
        expect(ACTION_LABELS.duplicateClipToNextBar).toBe('Duplicate clip to next bar');
    });

    it('labels every app action the shortcut pipeline can dispatch', () => {
        // Admission refusals describe through `ACTION_LABELS[type] ?? type`
        // (see describeRefusal in executeUserAppAction), so every action type
        // dispatched on that seam needs a label or the warning shows the raw
        // token. This pin derives only the SHORTCUT PIPELINE: the store's
        // `appAction` definitions, the `callbackAppActionTypes` table below,
        // and the four AI-chord literals. Component-keyboard seams (e.g. the
        // track-list row Delete dispatching removeTrack) and the
        // command-palette Enter dispatch sit OUTSIDE this pin — tracked
        // separately in #3829.
        const definitions = realShortcutStores.shortcutStore.value?.definitions ?? [];

        // Shortcut definitions that dispatch an app action directly.
        const fromDefinitions = definitions.flatMap((def) =>
            def.action.type === 'appAction' ? [def.action.action.type] : []
        );

        // Callback definitions whose handleKeydown branch settles into an
        // executeUserAppAction dispatch. Keyed by callback id; keep in sync
        // with the callback switch in handleKeydown.ts. Every other callback
        // calls a domain use case directly instead of the action seam, so
        // admission can never refuse it and it needs no label.
        const callbackAppActionTypes: Record<string, string[]> = {
            // `deleteSelection` deletes the selected clips through
            // executeUserAppAction({ type: 'removeClip' }).
            deleteSelection: ['removeClip'],
        };
        const fromCallbacks = definitions.flatMap((def) =>
            def.action.type === 'callback' ? (callbackAppActionTypes[def.action.id] ?? []) : []
        );

        // The `g`-leader AI chord resolves in `dispatchAiChord` in
        // handleKeydown.ts, not in a shortcut definition, so its action types
        // cannot be derived from the store. Pinned here; keep in sync with
        // `dispatchAiChord`.
        const aiChordActionTypes = [
            'generateBassline',
            'generateDrumPattern',
            'generateMelody',
            'generateChordProgression',
        ];

        const reachableTypes = new Set([...fromDefinitions, ...fromCallbacks, ...aiChordActionTypes]);
        const unlabeled = [...reachableTypes].filter((type) => ACTION_LABELS[type] === undefined);

        expect(unlabeled, 'keystroke-reachable action types missing from ACTION_LABELS').toEqual([]);
    });
});

describe('describeAction', () => {
    it('returns known label for known action type', () => {
        expect(describeAction({ type: 'addTrack', payload: {} } as never)).toBe('Add track');
    });

    it('appends name when payload has name', () => {
        expect(describeAction({ type: 'addTrack', payload: { name: 'Drums' } } as never)).toBe('Add track: Drums');
    });

    it('appends bpm when payload has bpm', () => {
        expect(describeAction({ type: 'setTempo', payload: { bpm: 140 } } as never)).toBe('Set tempo: 140 BPM');
    });

    it('appends kind when payload has kind', () => {
        expect(describeAction({ type: 'addTrack', payload: { kind: 'midi' } } as never)).toBe('Add track (midi)');
    });

    it('appends deviceType when payload has deviceType', () => {
        expect(describeAction({ type: 'addDevice', payload: { deviceType: 'Gluten' } } as never)).toBe(
            'Add device: Gluten'
        );
    });

    it('appends paramId and value', () => {
        expect(describeAction({ type: 'setDeviceParameter', payload: { paramId: 'gain', value: 0.8 } } as never)).toBe(
            'Set parameter: gain = 0.8'
        );
    });

    it('appends semitones with sign', () => {
        expect(describeAction({ type: 'transposeNotes', payload: { semitones: 5 } } as never)).toBe('Transpose: +5st');
        expect(describeAction({ type: 'transposeNotes', payload: { semitones: -3 } } as never)).toBe('Transpose: -3st');
    });

    it('should include payload kind when no name branch matches', () => {
        // Off-contract payload: no AppAction member pairs `kind` without `name`,
        // but persisted/legacy actions can carry drifted payload shapes, and the
        // kind branch must still render them.
        const offContractAction: { type: AppAction['type']; payload?: unknown } = {
            type: 'togglePlayback',
            payload: { kind: 'aux' },
        };
        expect(describeAction(offContractAction as AppAction)).toBe('Play/pause (aux)');
    });

    it('appends gain as percentage', () => {
        expect(describeAction({ type: 'setTrackGain', payload: { gain: 0.75 } } as never)).toBe('Set gain: 75%');
    });

    it('uses the base label when an internal sidechain gain has not been captured yet', () => {
        expect(
            describeAction({
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'source', targetTrackId: 'target' },
            })
        ).toBe('Add sidechain route');
    });

    it('appends tool name', () => {
        expect(describeAction({ type: 'setEditingTool', payload: { tool: 'marquee' } } as never)).toBe(
            'Set tool: marquee'
        );
    });

    it('humanizes unknown action types', () => {
        const result = describeAction({ type: 'freezeTrack', payload: {} } as never);
        expect(result).toBe('Freeze track');
    });

    it('humanizes camelCase with acronyms', () => {
        const result = describeAction({ type: 'audioToMidi', payload: {} } as never);
        expect(result).toContain('MIDI');
    });

    it('returns base label when payload is empty', () => {
        expect(describeAction({ type: 'togglePlayback', payload: {} } as never)).toBe('Play/pause');
    });

    it('handles payload with multiple fields (name takes priority)', () => {
        const result = describeAction({ type: 'addTrack', payload: { name: 'Lead', kind: 'midi' } } as never);
        expect(result).toBe('Add track: Lead');
    });
});
