import { describe, expect, it } from 'vitest';

import { assertPublicationSafeEvidence, unsafeCredentialReason } from '../evidenceSafety.ts';
import { parseReviewDocument } from '../reviewDocumentParser.ts';

// Credential-shaped fixtures are composed at runtime: the pull-request diff secret scan matches
// their literals in source.
const keyBody = (length: number): string => 'a1B2c3D4e5'.repeat(Math.ceil(length / 10)).slice(0, length);
const anthropicKey = `${['sk', 'ant', 'api03'].join('-')}-${keyBody(40)}`;
const openAiKey = `${['sk', ''].join('-')}${keyBody(48)}`;
const openAiProjectKey = `${['sk', 'proj', ''].join('-')}${keyBody(48)}`;
const slackToken = `${['xo', 'xb'].join('')}-1234567890-${keyBody(24)}`;
const slackWebhook = `${['https://hooks', 'slack', 'com/services/'].join('.')}T000/B000/${keyBody(24)}`;
const googleKey = `${['AI', 'za'].join('')}${keyBody(35)}`;
const gitLabToken = `${['gl', 'pat'].join('')}-${keyBody(20)}`;
const basicCredential = Buffer.from(['robot', 'hunter2'].join(':')).toString('base64');
const basicHeader = `${['Author', 'ization'].join('')}: Basic ${basicCredential}`;
const basicScheme = `sent basic ${basicCredential} upstream`;
const urlUserinfo = `${['https:', '', 'robot'].join('/')}:${['hun', 'ter2'].join('')}@example.com/repo`;

describe('unsafeCredentialReason', () => {
    it.each([
        ['an Anthropic API key', anthropicKey],
        ['an OpenAI API key', openAiKey],
        ['an OpenAI API key', openAiProjectKey],
        ['a Slack token', slackToken],
        ['a Slack webhook URL', slackWebhook],
        ['a Google API key', googleKey],
        ['a GitLab personal access token', gitLabToken],
        ['an HTTP Basic credential', basicHeader],
        ['an HTTP Basic credential', basicScheme],
        ['a URL carrying credentials', urlUserinfo],
    ])('refuses %s', (reason, credential) => {
        expect(unsafeCredentialReason(`the run logged ${credential} once`)).toBe(reason);
    });

    it.each([
        'basic usage of the mixer stays covered',
        'the desk-top layout keeps its task-list order',
        'a risk-assessment-for-the-transport-scheduler note',
        'Basic TypeScript conventions hold',
        'ssh clones from git@github.com:owner/repo.git',
        'the docs live at https://example.com/path?a=1',
    ])('admits the prose %j', (prose) => {
        expect(unsafeCredentialReason(prose)).toBeUndefined();
    });
});

describe('assertPublicationSafeEvidence invisible characters', () => {
    it.each([
        ['a zero-width space', 'correct\u200Bness'],
        ['a zero-width joiner', 'correct\u200Dness'],
        ['a byte-order mark', 'correct\uFEFFness'],
        ['a bidi override', 'correct\u202Eness'],
        ['a tab', 'correct\tness'],
        ['a trailing variation selector', 'correctness\uFE0F'],
        ['a combining grapheme joiner', 'correctness\u034F'],
        ['a Hangul filler', 'correct\u3164ness'],
    ])('refuses %s', (_name, value) => {
        expect(() => assertPublicationSafeEvidence('stance', [value])).toThrow(
            /stance value at index 0 contains an invisible or control character U\+[0-9A-F]{4}/u
        );
    });

    it.each([
        ['a trailing variation selector', 'correctness\uFE0F', 'FE0F'],
        ['a combining grapheme joiner', 'correctness\u034F', '034F'],
    ])('refuses a stance variant carrying %s when the review document is parsed', (_name, stance, codePoint) => {
        const document = {
            event: 'APPROVE',
            body: 'Attacked the null check; it held.',
            reviewerModel: 'glm-5.3-flash',
            draws: [
                { stance: 'correctness', reviewerModel: 'glm-5.3-flash', tier: 'standard', outcome: 'clean' },
                { stance, reviewerModel: 'glm-5.3-flash', tier: 'standard', outcome: 'clean' },
            ],
        };
        expect(() => parseReviewDocument(document)).toThrow(
            new RegExp(
                `review\\.json draws\\[1\\]\\.stance value at index 0 contains an invisible or control character U\\+${codePoint}`,
                'u'
            )
        );
    });

    it('keeps admitting decomposed accented prose, which carries combining marks but no ignorable', () => {
        expect(() => assertPublicationSafeEvidence('observed', ['Cafe\u0301 preset reloads intact'])).not.toThrow();
    });

    it('refuses a zero-width stance variant when the review document is parsed', () => {
        const document = {
            event: 'REQUEST_CHANGES',
            body: 'Blocking comment below.',
            comments: [
                {
                    path: 'src/example.ts',
                    line: 1,
                    side: 'RIGHT',
                    defect: 'The null check is inverted.',
                    consequence: 'The gate never opens.',
                    done: 'Fix the comparison.',
                },
            ],
            reviewerModel: 'glm-5.3-flash',
            draws: [
                { stance: 'correctness', reviewerModel: 'glm-5.3-flash', tier: 'standard', outcome: 'findings' },
                { stance: 'correct\u200Bness', reviewerModel: 'glm-5.3-flash', tier: 'standard', outcome: 'clean' },
            ],
        };
        expect(() => parseReviewDocument(document)).toThrow(
            /review\.json draws\[1\]\.stance value at index 0 contains an invisible or control character U\+200B/u
        );
    });
});
