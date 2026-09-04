import { describe, expect, it } from 'vitest';

import { parseCommandBatchDecline } from '../parseCommandBatchDecline';

describe('parseCommandBatchDecline', () => {
    it('accepts a bounded decline and copies its questions away from the provider payload', () => {
        const questions = ['Which key?'];

        const parsed = parseCommandBatchDecline({ kind: 'clarify', reason: 'Ambiguous.', questions });

        expect(parsed).toEqual({
            status: 'accepted',
            decline: { kind: 'clarify', reason: 'Ambiguous.', questions: ['Which key?'] },
        });
        expect(parsed.status === 'accepted' && parsed.decline.questions).not.toBe(questions);
    });

    it('refuses a decline carrying an argument the catalog contract does not define', () => {
        expect(
            parseCommandBatchDecline({
                kind: 'clarify',
                reason: 'Ambiguous.',
                questions: [],
                commands: [{ name: 'addTrack' }],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Provider decline carries an argument outside the catalog contract.',
        });
    });

    it('refuses a kind outside the two the application admits', () => {
        expect(parseCommandBatchDecline({ kind: 'refuse', reason: 'No.', questions: [] })).toEqual({
            status: 'rejected',
            reason: 'Provider decline field kind must be clarify or unsupported.',
        });
    });

    it('refuses a reason that is empty or longer than the bound', () => {
        expect(parseCommandBatchDecline({ kind: 'clarify', reason: '', questions: [] })).toEqual({
            status: 'rejected',
            reason: 'Provider decline field reason must be text of at most 512 characters.',
        });
        expect(parseCommandBatchDecline({ kind: 'clarify', reason: 'x'.repeat(513), questions: [] })).toEqual({
            status: 'rejected',
            reason: 'Provider decline field reason must be text of at most 512 characters.',
        });
    });

    it('refuses more questions than the bound and a question that is not bounded text', () => {
        expect(
            parseCommandBatchDecline({ kind: 'clarify', reason: 'Ambiguous.', questions: ['a', 'b', 'c', 'd', 'e'] })
        ).toEqual({
            status: 'rejected',
            reason: 'Provider decline field questions must hold at most 4 bounded questions.',
        });
        expect(parseCommandBatchDecline({ kind: 'clarify', reason: 'Ambiguous.', questions: [''] })).toEqual({
            status: 'rejected',
            reason: 'Provider decline field questions must hold at most 4 bounded questions.',
        });
        expect(parseCommandBatchDecline({ kind: 'clarify', reason: 'Ambiguous.', questions: 'Which key?' })).toEqual({
            status: 'rejected',
            reason: 'Provider decline field questions must hold at most 4 bounded questions.',
        });
    });
});
