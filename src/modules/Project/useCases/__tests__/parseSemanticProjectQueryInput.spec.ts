/**
 * The published argument contract for a semantic project query.
 *
 * Every caller that carries a query in from outside the application admits it
 * through this function, so what it refuses is the contract itself rather than
 * one caller's reading of it. The cases below are the ones a lax parser gets
 * wrong: a key nobody published, a string longer than the bound, a page larger
 * than the ceiling, and a value outside a closed vocabulary.
 */

import { describe, expect, it } from 'vitest';

import { MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH, MAX_SEMANTIC_QUERY_PAGE_SIZE } from '../../models/SemanticProjectQuery';
import { parseSemanticProjectQueryInput } from '../parseSemanticProjectQueryInput';

describe('parseSemanticProjectQueryInput', () => {
    it('refuses a key the contract does not publish rather than dropping it', () => {
        expect(parseSemanticProjectQueryInput({ type: 'project-summary', unknownKey: 1 })).toEqual({
            status: 'invalid',
            reason: 'arguments',
        });
        expect(parseSemanticProjectQueryInput({ type: 'project-summary', filters: { unknownFilter: 'x' } })).toEqual({
            status: 'invalid',
            reason: 'filters',
        });
    });

    it('refuses a query type outside the published set', () => {
        expect(parseSemanticProjectQueryInput({ type: 'everything' })).toEqual({
            status: 'invalid',
            reason: 'arguments',
        });
    });

    it('refuses a filter string past the contract bound and accepts one at it', () => {
        const atBound = 'a'.repeat(MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH);

        expect(parseSemanticProjectQueryInput({ type: 'object', filters: { kind: `${atBound}a` } })).toEqual({
            status: 'invalid',
            reason: 'filters',
        });
        expect(parseSemanticProjectQueryInput({ type: 'object', filters: { kind: atBound } })).toEqual({
            status: 'valid',
            input: { type: 'object', filters: { kind: atBound } },
        });
    });

    it('refuses a page larger than the published ceiling and accepts the ceiling itself', () => {
        expect(
            parseSemanticProjectQueryInput({
                type: 'object',
                page: { limit: MAX_SEMANTIC_QUERY_PAGE_SIZE + 1 },
            })
        ).toEqual({ status: 'invalid', reason: 'page' });
        expect(
            parseSemanticProjectQueryInput({ type: 'object', page: { limit: MAX_SEMANTIC_QUERY_PAGE_SIZE } })
        ).toEqual({
            status: 'valid',
            input: { type: 'object', page: { limit: MAX_SEMANTIC_QUERY_PAGE_SIZE } },
        });
    });

    it('refuses a content type outside the closed vocabulary', () => {
        expect(parseSemanticProjectQueryInput({ type: 'object', filters: { contentType: 'video' } })).toEqual({
            status: 'invalid',
            reason: 'filters',
        });
        expect(parseSemanticProjectQueryInput({ type: 'object', filters: { contentType: 'midi' } })).toEqual({
            status: 'valid',
            input: { type: 'object', filters: { contentType: 'midi' } },
        });
    });

    it('refuses a filter carrying the wrong kind of value', () => {
        expect(parseSemanticProjectQueryInput({ type: 'object', filters: { selected: 'yes' } })).toEqual({
            status: 'invalid',
            reason: 'filters',
        });
        expect(parseSemanticProjectQueryInput({ type: 'object', filters: { minInferredConfidence: 1.5 } })).toEqual({
            status: 'invalid',
            reason: 'filters',
        });
    });

    it('round-trips a full input with every part of the contract present', () => {
        const input = {
            type: 'object',
            filters: {
                stableId: 'track-1',
                kind: 'track',
                selected: true,
                startBeat: 0,
                minInferredConfidence: 0.5,
                contentType: 'audio',
            },
            page: { limit: 10, cursor: 'cursor-1' },
            sinceRevision: 'revision-1',
        };

        expect(parseSemanticProjectQueryInput(input)).toEqual({ status: 'valid', input });
    });

    it('refuses a payload that is not an object at all', () => {
        expect(parseSemanticProjectQueryInput(null)).toEqual({ status: 'invalid', reason: 'arguments' });
        expect(parseSemanticProjectQueryInput([{ type: 'object' }])).toEqual({
            status: 'invalid',
            reason: 'arguments',
        });
    });

    it('refuses a revision token past the contract bound', () => {
        expect(parseSemanticProjectQueryInput({ type: 'object', sinceRevision: 'r'.repeat(65_537) })).toEqual({
            status: 'invalid',
            reason: 'revision',
        });
    });
});
