import { describe, it, expect, vi } from 'vitest';

import { type InjectableFunction } from '#/infra/di/inject';

import { notePitchToName, formatNotesForLlm, llmGenerateNotes } from '../llmNoteHelpers';

// llmGenerateNotes expects a DI-injectable tool-call runner; stamp the injectable
// metadata onto plain vi.fn mocks so they satisfy that contract.
function asInjectable<TMock extends (...args: never[]) => unknown>(mockFn: TMock): TMock & InjectableFunction {
    return Object.assign(mockFn, {
        _isInjectable: true,
        _deps: {},
        _factory: () => mockFn,
    });
}

describe('llmNoteHelpers', () => {
    describe('notePitchToName', () => {
        it('formats MIDI pitch to note name and octave', () => {
            expect(notePitchToName(60)).toBe('C4');
            expect(notePitchToName(62)).toBe('D4');
            expect(notePitchToName(64)).toBe('E4');
            expect(notePitchToName(65)).toBe('F4');
            expect(notePitchToName(69)).toBe('A4');
            expect(notePitchToName(71)).toBe('B4');
        });

        it('rejects a pitch that cannot map to a MIDI note name', () => {
            expect(() => notePitchToName(-1)).toThrow('Invalid MIDI pitch: -1');
        });
    });

    describe('formatNotesForLlm', () => {
        it('returns empty string representation when array is empty', () => {
            expect(formatNotesForLlm([])).toBe('(empty clip — no notes)');
        });

        it('formats a list of notes ordered by startBeat', () => {
            const notes = [
                { pitch: 64, startBeat: 1, duration: 0.5, velocity: 90 },
                { pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
            ];

            const result = formatNotesForLlm(notes);
            expect(result).toBe('C4(0-1,v100) E4(1-1.5,v90)');
        });
    });

    describe('llmGenerateNotes', () => {
        it('requests only addNotes via LLM and returns the note array', async () => {
            const mockRunToolCalls = vi.fn().mockResolvedValue([
                {
                    name: 'addNotes',
                    arguments: {
                        notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                    },
                },
            ]);

            const result = await llmGenerateNotes(
                asInjectable(mockRunToolCalls),
                'make a cool beat',
                [{ pitch: 64, startBeat: 1, duration: 0.5, velocity: 90 }],
                'clip-1'
            );

            expect(mockRunToolCalls).toHaveBeenCalledTimes(1);
            const call = mockRunToolCalls.mock.calls[0];
            if (!call) {
                throw new Error('Expected runToolCalls call');
            }
            const userMsg: unknown = call[1];
            const toolSchemas = call[2] as Array<{ function: { name: string } }> | undefined;
            if (typeof userMsg !== 'string') {
                throw new TypeError('Expected a string user message');
            }
            expect(userMsg).toContain('make a cool beat');
            expect(userMsg).toContain('E4(1-1.5,v90)');
            expect(userMsg).toContain('clip-1');
            expect(toolSchemas?.map((toolSchema) => toolSchema.function.name)).toEqual(['addNotes']);

            expect(result).toEqual([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        });

        it('returns empty array if LLM tool call has no notes or is not addNotes', async () => {
            const mockRunToolCalls = vi.fn().mockResolvedValue([{ name: 'otherTool', arguments: {} }]);

            const result = await llmGenerateNotes(asInjectable(mockRunToolCalls), 'instruction', [], 'c1');

            expect(result).toEqual([]);
        });
    });
});
