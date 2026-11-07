import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { type ProjectContext } from '../../../models/ProjectContext';
import { groundCompiledCommandBatch } from '../../groundCompiledCommandBatch';
import { refinementClauseReader } from '../refinementClauseReader';
import { refinementRequestReading } from '../refinementRequestReading';

registerDeviceEnginePorts();

type Track = ProjectContext['tracks'][number];
type Call = { name: string; arguments: Record<string, unknown> };

function track(id: string, name: string, overrides: Partial<Track> = {}): Track {
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
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        ...overrides,
    };
}

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
    automationLanes: [],
    tracks: [
        track('track-bass', 'Bass'),
        track('track-keys', 'Keys'),
        track('track-drums', 'Drums', {
            clipCount: 1,
            clips: [{ id: 'clip-snare', name: 'Snare Take', type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 }],
        }),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

const mute = (trackId: string): Call => ({ name: 'muteTrack', arguments: { trackId, muted: true } });
const solo = (trackId: string): Call => ({ name: 'soloTrack', arguments: { trackId, soloed: true } });

function basis(prompt: string, toolCalls: Call[]) {
    const result = groundCompiledCommandBatch({
        toolCalls,
        context,
        prompt,
        projectRevision: undefined,
        workflowCapabilityId: undefined,
        compilerEvidence: undefined,
        selectedCompilations: [],
        transformCommands: [],
        transformTargetIds: [],
        creativeAuthority: undefined,
        providerProposal: null,
    });
    if (result.status !== 'grounded' || result.groundingBasis === undefined) {
        throw new Error(`Expected real grounded basis for ${prompt}: ${result.status}`);
    }
    return result.groundingBasis;
}

function read(text: string, pending: ReturnType<typeof basis>) {
    const removals = refinementClauseReader.removals({ text, basis: pending, context });
    if (removals.status !== 'read') {
        throw new Error(`Expected removal reading: ${removals.status}`);
    }
    return { text, basis: pending, context, ...removals };
}

describe('refinement grammar at its owning readers', () => {
    it('asks for an apostrophe at a word boundary but reads internal apostrophes', () => {
        const text = "turn the mix' level down 2 dB";
        expect(refinementRequestReading.clauses(text, context)[0]?.masked).toContain("mix'");
        const result = refinementClauseReader.unreadMark({ text, context });
        expect(result).toMatchObject({
            reason: 'The refinement holds a mark its clause grammar does not read.',
            question: expect.stringContaining("'"),
        });
        expect(refinementClauseReader.unreadMark({ text: "don't touch Bass", context })).toBeNull();
    });

    it('reads quotes around an actual clip reference', () => {
        const text = 'leave "Snare Take" unchanged';
        const clauses = refinementRequestReading.clauses(text, context);
        expect(clauses).toHaveLength(1);
        expect(clauses[0]?.masked).toBe('leave "clip□□□□□□" unchanged');
        expect(refinementClauseReader.unreadMark({ text, context })).toBeNull();
    });

    it.each(['afresh', 'anew'])('asks whether an addition %s replaces the pending change', (word) => {
        const pending = basis('mute Keys', [mute('track-keys')]);
        const result = refinementClauseReader.combination(read(`mute Bass ${word}`, pending));
        expect(result).toMatchObject({
            status: 'clarify',
            reason: 'The refinement adds a change without saying whether the pending changes stay.',
            question: expect.stringContaining('replaces or restricts'),
        });
        expect(refinementClauseReader.combination(read('mute Bass', pending))).toEqual({ status: 'read' });
    });

    it('uses the source clause matching the pending action type', () => {
        const pending = basis('mute Bass and solo Bass', [mute('track-bass'), solo('track-bass')]);
        expect(pending.commands.map((command) => command.type)).toEqual(['muteTrack', 'soloTrack']);
        expect(refinementClauseReader.combination(read('solo Bass', pending))).toEqual({ status: 'read' });
    });

    it('reads an opening conjunction before a changed toggle', () => {
        const pending = basis('mute Bass', [mute('track-bass')]);
        for (const text of ['and unmute Bass', 'unmute Bass']) {
            const result = refinementClauseReader.values(read(text, pending));
            expect(result.status).toBe('bound');
            if (result.status !== 'bound') {
                throw new Error('Expected bound toggle');
            }
            expect([...result.values.entries()]).toEqual([
                [
                    0,
                    expect.objectContaining({
                        argument: 'muted',
                        toggled: false,
                        expected: null,
                        keptPendingDirection: false,
                    }),
                ],
            ]);
        }
    });

    it('keeps an already held toggle as a restatement', () => {
        const pending = basis('mute Bass', [mute('track-bass')]);
        const result = refinementClauseReader.values(read('mute Bass', pending));
        expect(result.status).toBe('bound');
        if (result.status !== 'bound') {
            throw new Error('Expected bound restatement');
        }
        expect([...result.values.entries()]).toEqual([]);
        expect(result.comparative).toBeNull();
    });
});
