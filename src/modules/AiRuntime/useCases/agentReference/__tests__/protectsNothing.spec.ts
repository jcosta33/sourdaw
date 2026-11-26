import { describe, expect, it } from 'vitest';

import { protectsNothing } from '../protectsNothing';
import { type Slot } from '../readProtectionSlots';
import { type SlotReading } from '../SlotReading';

type Members = Parameters<typeof protectsNothing>[2];

const masked = 'keep the Kick level punchy';
const members = 'the Kick level punchy';
const membersStart = masked.indexOf(members);

function slot(overrides: Partial<Slot> = {}): Slot {
    return {
        lead: 'verb',
        start: membersStart,
        end: masked.length,
        completeRange: { start: 0, end: masked.length },
        clause: { start: 0, end: masked.length },
        memberSeparators: [],
        strict: false,
        closer: null,
        exempts: false,
        otherwise: false,
        ...overrides,
    };
}

const nothingRead: Members = {
    unresolved: [],
    bound: [],
    selection: [],
    controls: [],
    unreadContinuations: [],
    nonTrackReferences: [],
};

const readSelection: SlotReading['selection'][number] = {
    phrase: 'it',
    scope: 'any',
    controls: [],
    pronoun: true,
    anaphoric: false,
};

describe('protectsNothing', () => {
    it('reads a protection verb whose stated members read nothing as protecting nothing', () => {
        expect(protectsNothing(slot(), masked, nothingRead)).toBe(true);
    });

    it.each<[string, Partial<Members>]>([
        ['an unresolved object form', { unresolved: ['Ghost'] }],
        ['a bound track', { bound: [{ trackIds: ['track-kick'], controls: [], byName: true }] }],
        ['a selection phrase', { selection: [readSelection] }],
        ['an ownerless control', { controls: ['fader'] }],
        ['unread continuation text', { unreadContinuations: [{ start: membersStart, end: masked.length }] }],
        ['a reference naming no track', { nonTrackReferences: [{ start: membersStart, end: masked.length }] }],
    ])('keeps a clause stating %s', (_label, read) => {
        expect(protectsNothing(slot(), masked, { ...nothingRead, ...read })).toBe(false);
    });

    it.each(['prohibition', 'carve-out'] as const)('keeps a clause a %s opens', (lead) => {
        expect(protectsNothing(slot({ lead }), masked, nothingRead)).toBe(false);
    });

    it('keeps a clause opened by nothing', () => {
        expect(protectsNothing(slot({ lead: null }), masked, nothingRead)).toBe(false);
    });

    it('keeps a clause that states no members', () => {
        const bare = 'keep   ';

        expect(protectsNothing(slot({ start: 4, end: bare.length }), bare, nothingRead)).toBe(false);
    });
});
