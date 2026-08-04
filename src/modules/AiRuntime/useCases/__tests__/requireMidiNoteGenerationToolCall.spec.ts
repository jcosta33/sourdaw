import { describe, expect, it } from 'vitest';

import { requireMidiNoteGenerationToolCall } from '../requireMidiNoteGenerationToolCall';

describe('requireMidiNoteGenerationToolCall', () => {
    it('returns notes from exactly one valid addNotes call for the requested clip', () => {
        const notes = requireMidiNoteGenerationToolCall({
            toolCalls: [
                {
                    name: 'addNotes',
                    arguments: {
                        clipId: 'clip-1',
                        notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 96 }],
                    },
                },
            ],
            expectedClipId: 'clip-1',
        });

        expect(notes).toEqual([{ pitch: 60, startBeat: 0, duration: 1, velocity: 96 }]);
    });

    it.each([
        { label: 'no calls', calls: [] },
        {
            label: 'multiple calls',
            calls: [
                { name: 'addNotes', arguments: { clipId: 'clip-1', notes: [] } },
                { name: 'addNotes', arguments: { clipId: 'clip-1', notes: [] } },
            ],
        },
    ])('rejects $label instead of selecting part of the batch', ({ calls }) => {
        expect(() => requireMidiNoteGenerationToolCall({ toolCalls: calls, expectedClipId: 'clip-1' })).toThrow(
            'exactly one addNotes tool call'
        );
    });

    it('rejects a wrong tool or a call targeting another clip', () => {
        expect(() =>
            requireMidiNoteGenerationToolCall({
                toolCalls: [{ name: 'removeClip', arguments: { clipId: 'clip-1' } }],
                expectedClipId: 'clip-1',
            })
        ).toThrow('exactly one addNotes tool call');
        expect(() =>
            requireMidiNoteGenerationToolCall({
                toolCalls: [
                    {
                        name: 'addNotes',
                        arguments: {
                            clipId: 'clip-2',
                            notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
                        },
                    },
                ],
                expectedClipId: 'clip-1',
            })
        ).toThrow('requested clip');
    });

    it.each([
        {
            label: 'an empty note list',
            arguments: { clipId: 'clip-1', notes: [] },
        },
        {
            label: 'a missing required note field',
            arguments: { clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0 }] },
        },
        {
            label: 'an out-of-range note field',
            arguments: { clipId: 'clip-1', notes: [{ pitch: 128, startBeat: 0, duration: 1 }] },
        },
        {
            label: 'an unexpected note field',
            arguments: {
                clipId: 'clip-1',
                notes: [{ pitch: 60, startBeat: 0, duration: 1, channel: 2 }],
            },
        },
        {
            label: 'an unexpected payload field',
            arguments: {
                clipId: 'clip-1',
                notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
                replace: true,
            },
        },
    ])('rejects $label', ({ arguments: callArguments }) => {
        expect(() =>
            requireMidiNoteGenerationToolCall({
                toolCalls: [{ name: 'addNotes', arguments: callArguments }],
                expectedClipId: 'clip-1',
            })
        ).toThrow('valid non-empty MIDI note list');
    });

    it('allows a negative start beat only for backward completion', () => {
        const toolCalls = [
            {
                name: 'addNotes',
                arguments: {
                    clipId: 'clip-1',
                    notes: [{ pitch: 58, startBeat: -4, duration: 1 }],
                },
            },
        ];

        expect(() => requireMidiNoteGenerationToolCall({ toolCalls, expectedClipId: 'clip-1' })).toThrow(
            'valid non-empty MIDI note list'
        );
        expect(
            requireMidiNoteGenerationToolCall({
                toolCalls,
                expectedClipId: 'clip-1',
                allowNegativeStartBeat: true,
            })
        ).toEqual([{ pitch: 58, startBeat: -4, duration: 1 }]);
    });
});
