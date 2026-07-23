import { describe, it, expect } from 'vitest';

import {
    NO_DEVICE_AUTOMATION_TARGET,
    UNRESOLVED_DEVICE_AUTOMATION_TARGET,
    createDeviceAutomationTargetId,
    getDeviceAutomationParameterId,
    resolveDeviceAutomationTargetIndex,
} from '../automationDeviceTarget';

describe('createDeviceAutomationTargetId', () => {
    it('joins deviceId and parameterId with a colon', () => {
        expect(createDeviceAutomationTargetId('dev-1', 'freq')).toBe('dev-1:freq');
    });
});

describe('getDeviceAutomationParameterId', () => {
    it('extracts the parameterId after the first colon', () => {
        expect(getDeviceAutomationParameterId('dev-1:freq')).toBe('freq');
    });

    it('returns the whole string as parameterId when no colon exists', () => {
        expect(getDeviceAutomationParameterId('freq')).toBe('freq');
    });

    it('returns null when the parameterId is empty after the colon', () => {
        expect(getDeviceAutomationParameterId('dev-1:')).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(getDeviceAutomationParameterId('')).toBeNull();
    });

    it('handles parameterIds containing colons (splits on first only)', () => {
        expect(getDeviceAutomationParameterId('dev-1:param:sub')).toBe('param:sub');
    });
});

describe('resolveDeviceAutomationTargetIndex', () => {
    const candidates = [
        { deviceId: 'dev-1', deviceType: 'fermenter' },
        { deviceId: 'dev-2', deviceType: 'gluten' },
    ];
    const acceptsAll = () => true;
    const acceptsNone = () => false;

    it('resolves to the matching device by canonical id', () => {
        const index = resolveDeviceAutomationTargetIndex('dev-2:freq', candidates, acceptsAll);
        expect(index).toBe(1);
    });

    it('returns UNRESOLVED when no candidate matches the owner id', () => {
        expect(resolveDeviceAutomationTargetIndex('dev-99:freq', candidates, acceptsAll)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('returns UNRESOLVED when the candidate rejects the parameter', () => {
        expect(resolveDeviceAutomationTargetIndex('dev-1:freq', candidates, acceptsNone)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('returns UNRESOLVED when the parameterId is empty', () => {
        expect(resolveDeviceAutomationTargetIndex('dev-1:', candidates, acceptsAll)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('returns UNRESOLVED when the owner id before the colon is empty', () => {
        expect(resolveDeviceAutomationTargetIndex(':freq', candidates, acceptsAll)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('resolves by deviceType (legacy match) when no canonical id matches', () => {
        const index = resolveDeviceAutomationTargetIndex('gluten:threshold', candidates, acceptsAll);
        expect(index).toBe(1);
    });

    it('prefers canonical id over legacy deviceType when both match the same candidate', () => {
        // dev-1 has deviceType 'fermenter'. Target 'dev-1' matches canonically.
        const index = resolveDeviceAutomationTargetIndex('dev-1:freq', candidates, acceptsAll);
        expect(index).toBe(0);
    });

    it('returns UNRESOLVED when multiple candidates share the same canonical id (ambiguous)', () => {
        const dupes = [
            { deviceId: 'dev-1', deviceType: 'a' },
            { deviceId: 'dev-1', deviceType: 'b' },
        ];
        expect(resolveDeviceAutomationTargetIndex('dev-1:freq', dupes, acceptsAll)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('prefers canonical id over legacy deviceType when a legacy match exists on a different candidate', () => {
        // dev-2 matches canonically; candidate dev-3 has deviceType 'dev-2' (legacy).
        // Canonical must win.
        const mixed = [
            { deviceId: 'dev-2', deviceType: 'fermenter' },
            { deviceId: 'dev-3', deviceType: 'dev-2' },
        ];
        const index = resolveDeviceAutomationTargetIndex('dev-2:freq', mixed, acceptsAll);
        expect(index).toBe(0);
    });

    it('returns UNRESOLVED when multiple candidates share the same deviceType as the owner (legacy ambiguity)', () => {
        // No canonical match; two candidates have deviceType matching the owner.
        const legacyDupes = [
            { deviceId: 'dev-a', deviceType: 'shared' },
            { deviceId: 'dev-b', deviceType: 'shared' },
        ];
        expect(resolveDeviceAutomationTargetIndex('shared:freq', legacyDupes, acceptsAll)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('resolves via the no-colon legacy path to the first accepting candidate', () => {
        // No colon → parameterId is the whole string, match by acceptsParameter.
        // The acceptor must accept only ONE candidate to avoid ambiguity.
        const index = resolveDeviceAutomationTargetIndex(
            'freq',
            candidates,
            (candidate, param) => param === 'freq' && candidate.deviceId === 'dev-1'
        );
        expect(index).toBe(0);
    });

    it('returns UNRESOLVED on the legacy path when multiple candidates accept (ambiguous)', () => {
        const bothAccept = () => true;
        // No colon, both accept → ambiguous.
        expect(resolveDeviceAutomationTargetIndex('freq', candidates, bothAccept)).toBe(
            UNRESOLVED_DEVICE_AUTOMATION_TARGET
        );
    });

    it('returns NO_DEVICE_AUTOMATION_TARGET (-1) on the legacy path when no candidate accepts', () => {
        expect(resolveDeviceAutomationTargetIndex('freq', candidates, acceptsNone)).toBe(NO_DEVICE_AUTOMATION_TARGET);
    });

    it('works with the {id, type} candidate shape', () => {
        const altCandidates = [
            { id: 'dev-a', type: 'fermenter' },
            { id: 'dev-b', type: 'toaster' },
        ];
        const index = resolveDeviceAutomationTargetIndex('dev-b:pattern', altCandidates, acceptsAll);
        expect(index).toBe(1);
    });
});
