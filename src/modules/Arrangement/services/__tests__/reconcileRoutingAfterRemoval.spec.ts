import { describe, it, expect } from 'vitest';

import { reconcileRoutingAfterRemoval } from '../reconcileRoutingAfterRemoval';

import type { Track } from '../../models/Track';

/**
 * Pure graph-logic specs for reconcileRoutingAfterRemoval. Zero existing spec
 * coverage. Tests cover: output repointing (inherited destination), send dropping,
 * acyclic fallback cascade (candidate → master → hw_out), and edge cases.
 */

function makeTrack(
    id: string,
    outputId: string,
    sends: Array<{ busId: string; level: number; preFader: boolean }> = []
): Track {
    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#999',
        clips: [],
        devices: [],
        sends,
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId,
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: `${id}-alt-default`,
        alternatives: [{ id: `${id}-alt-default`, name: 'Alt 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

describe('reconcileRoutingAfterRemoval — output repointing (inherit destination)', () => {
    it('repoints dependents to the removed track own destination (Kick→BusA→BusB, delete BusA)', () => {
        const kick = makeTrack('kick', 'busA');
        const busB = makeTrack('busB', 'master');

        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'busB',
            remainingTracks: [kick, busB],
        });

        // kick was routed to busA; busA was routed to busB. kick inherits busB.
        const repointedKick = result.tracks.find((t) => t.id === 'kick');
        expect(repointedKick?.outputId).toBe('busB');
        expect(result.repointedOutputs).toContainEqual({ trackId: 'kick', outputId: 'busB' });
    });

    it('falls back to master when removedOutputId is undefined', () => {
        const kick = makeTrack('kick', 'busA');
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: undefined,
            remainingTracks: [kick],
        });
        const repointedKick = result.tracks.find((t) => t.id === 'kick');
        expect(repointedKick?.outputId).toBe('master');
    });

    it('falls back to master when removedOutputId equals removedTrackId (self-referential)', () => {
        const kick = makeTrack('kick', 'busA');
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'busA',
            remainingTracks: [kick],
        });
        const repointedKick = result.tracks.find((t) => t.id === 'kick');
        expect(repointedKick?.outputId).toBe('master');
    });

    it('inherits a terminal destination (master or hw_out) from the removed track', () => {
        const kick = makeTrack('kick', 'busA');
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'hw_out',
            remainingTracks: [kick],
        });
        const repointedKick = result.tracks.find((t) => t.id === 'kick');
        expect(repointedKick?.outputId).toBe('hw_out');
    });

    it('does not repoint tracks whose outputId is not the removed track', () => {
        const kick = makeTrack('kick', 'master');
        const snare = makeTrack('snare', 'busA');
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'master',
            remainingTracks: [kick, snare],
        });
        // kick already routes to master — unchanged.
        const unchangedKick = result.tracks.find((t) => t.id === 'kick');
        expect(unchangedKick?.outputId).toBe('master');
        expect(result.repointedOutputs).not.toContainEqual({ trackId: 'kick', outputId: 'master' });
    });
});

describe('reconcileRoutingAfterRemoval — send dropping', () => {
    it('drops sends targeting the removed bus', () => {
        const kick = makeTrack('kick', 'master', [
            { busId: 'busA', level: 0.5, preFader: false },
            { busId: 'busB', level: 0.3, preFader: true },
        ]);
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'master',
            remainingTracks: [kick],
        });
        const kickResult = result.tracks.find((t) => t.id === 'kick');
        expect(kickResult?.sends).toHaveLength(1);
        expect(kickResult?.sends[0]?.busId).toBe('busB');
    });

    it('leaves sends unchanged when none target the removed bus', () => {
        const kick = makeTrack('kick', 'master', [{ busId: 'busB', level: 0.5, preFader: false }]);
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'master',
            remainingTracks: [kick],
        });
        const kickResult = result.tracks.find((t) => t.id === 'kick');
        expect(kickResult?.sends).toHaveLength(1);
    });
});

describe('reconcileRoutingAfterRemoval — acyclic fallback cascade', () => {
    it('falls back to master when the inherited destination would create a cycle', () => {
        // Pre-existing cycle: kick → busA → kick. Delete busA. busA's output was kick.
        // Inheriting kick would close the loop kick → kick. Falls back to master.
        const kick = makeTrack('kick', 'busA');
        // busA is being deleted. Before deletion: kick → busA → kick (cycle).
        // After deletion: kick.outputId = inheritedOutputId.
        // inheritedOutputId = removedOutputId = 'kick' (busA's output).
        // But kick is a surviving track, so inheritedOutputId = 'kick'.
        // resolveAcyclicDestination(kick, 'kick', [kick]) → wouldCreateRoutingCycle (self-loop) → master.
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'kick',
            remainingTracks: [kick],
        });
        const repointedKick = result.tracks.find((t) => t.id === 'kick');
        expect(repointedKick?.outputId).toBe('master');
    });

    it('uses candidate when it does not create a cycle', () => {
        // kick → busA, busA → busB. Delete busA. busB survives.
        // kick inherits busB. No cycle (busB → master, doesn't loop back to kick).
        const kick = makeTrack('kick', 'busA');
        const busB = makeTrack('busB', 'master');
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'busB',
            remainingTracks: [kick, busB],
        });
        const repointedKick = result.tracks.find((t) => t.id === 'kick');
        expect(repointedKick?.outputId).toBe('busB');
    });
});

describe('reconcileRoutingAfterRemoval — repointedOutputs', () => {
    it('lists only tracks whose outputId actually changed', () => {
        const kick = makeTrack('kick', 'busA');
        const snare = makeTrack('snare', 'busA');
        const hat = makeTrack('hat', 'master'); // unchanged
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'master',
            remainingTracks: [kick, snare, hat],
        });
        expect(result.repointedOutputs).toHaveLength(2);
        expect(result.repointedOutputs).toContainEqual({ trackId: 'kick', outputId: 'master' });
        expect(result.repointedOutputs).toContainEqual({ trackId: 'snare', outputId: 'master' });
    });

    it('returns empty repointedOutputs when no track referenced the removed id', () => {
        const kick = makeTrack('kick', 'master');
        const result = reconcileRoutingAfterRemoval({
            removedTrackId: 'busA',
            removedOutputId: 'master',
            remainingTracks: [kick],
        });
        expect(result.repointedOutputs).toEqual([]);
    });
});
