import { describe, expect, it } from 'vitest';

import {
    matchControllerProfile,
    type ConnectedControllerIdentity,
    type ControllerProfileMatchCandidate,
    type MatchControllerProfileInput,
} from '../matchControllerProfile';

const PUSH_SYSEX_IDENTITY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x21, 0x1d, 0x67, 0x19, 0x02, 0xf7] as const;

const createCandidate = (overrides: Partial<ControllerProfileMatchCandidate> = {}): ControllerProfileMatchCandidate => {
    return {
        profileId: 'push-2',
        stableNativeIdentities: ['usb:2982:1967'],
        acceptedSysExIdentityReplies: [PUSH_SYSEX_IDENTITY],
        manufacturer: 'Ableton AG',
        productAliases: ['Push 2'],
        ...overrides,
    };
};

const createConnectedIdentity = (overrides: Partial<ConnectedControllerIdentity> = {}): ConnectedControllerIdentity => {
    return {
        instanceId: 'instance-1',
        fingerprint: 'fingerprint:push-2:desk',
        stableNativeIdentity: 'usb:2982:1967',
        sysexIdentityReply: PUSH_SYSEX_IDENTITY,
        manufacturer: 'Ableton AG',
        productName: 'Push 2',
        ...overrides,
    };
};

describe('matchControllerProfile', () => {
    it('should prefer an exact explicit fingerprint binding over every automatic identity tier', () => {
        const explicitlyBound = createCandidate({
            profileId: 'explicit-profile',
            stableNativeIdentities: ['usb:other'],
            acceptedSysExIdentityReplies: [[0xf0, 0x01, 0xf7]],
            manufacturer: 'Other',
            productAliases: ['Other'],
        });
        const nativeMatch = createCandidate({ profileId: 'native-profile' });
        const sysexMatch = createCandidate({
            profileId: 'sysex-profile',
            stableNativeIdentities: ['usb:not-connected'],
        });
        const aliasMatch = createCandidate({
            profileId: 'alias-profile',
            stableNativeIdentities: ['usb:not-connected'],
            acceptedSysExIdentityReplies: [[0xf0, 0x01, 0xf7]],
        });

        const result = matchControllerProfile({
            candidates: [aliasMatch, sysexMatch, nativeMatch, explicitlyBound],
            connectedIdentity: createConnectedIdentity(),
            explicitFingerprintBinding: {
                fingerprint: 'fingerprint:push-2:desk',
                profileId: 'explicit-profile',
            },
        });

        expect(result).toEqual({
            status: 'match',
            connectedInstanceId: 'instance-1',
            basis: 'explicit-fingerprint-binding',
            candidate: explicitlyBound,
        });
    });

    it('should prefer an exact stable native identity over SysEx and alias matches', () => {
        const nativeMatch = createCandidate({ profileId: 'native-profile' });
        const sysexMatch = createCandidate({
            profileId: 'sysex-profile',
            stableNativeIdentities: ['usb:not-connected'],
        });
        const aliasMatch = createCandidate({
            profileId: 'alias-profile',
            stableNativeIdentities: ['usb:not-connected'],
            acceptedSysExIdentityReplies: [[0xf0, 0x01, 0xf7]],
        });

        const result = matchControllerProfile({
            candidates: [aliasMatch, sysexMatch, nativeMatch],
            connectedIdentity: createConnectedIdentity(),
            explicitFingerprintBinding: {
                fingerprint: 'fingerprint:another-device',
                profileId: 'alias-profile',
            },
        });

        expect(result).toEqual({
            status: 'match',
            connectedInstanceId: 'instance-1',
            basis: 'stable-native-identity',
            candidate: nativeMatch,
        });
    });

    it('should prefer an exact accepted SysEx reply over an alias match', () => {
        const sysexMatch = createCandidate({
            profileId: 'sysex-profile',
            stableNativeIdentities: ['usb:not-connected'],
        });
        const aliasMatch = createCandidate({
            profileId: 'alias-profile',
            stableNativeIdentities: ['usb:not-connected'],
            acceptedSysExIdentityReplies: [[0xf0, 0x01, 0xf7]],
        });

        const result = matchControllerProfile({
            candidates: [aliasMatch, sysexMatch],
            connectedIdentity: createConnectedIdentity({ stableNativeIdentity: undefined }),
        });

        expect(result).toEqual({
            status: 'match',
            connectedInstanceId: 'instance-1',
            basis: 'sysex-identity-reply',
            candidate: sysexMatch,
        });
    });

    it('should use normalized exact manufacturer and product alias equality as the final tier', () => {
        const candidate = createCandidate({
            stableNativeIdentities: undefined,
            acceptedSysExIdentityReplies: undefined,
        });

        const result = matchControllerProfile({
            candidates: [candidate],
            connectedIdentity: createConnectedIdentity({
                fingerprint: undefined,
                stableNativeIdentity: undefined,
                sysexIdentityReply: undefined,
                manufacturer: '  ABLETON\tAG  ',
                productName: '  Push   2  ',
            }),
        });

        expect(result).toEqual({
            status: 'match',
            connectedInstanceId: 'instance-1',
            basis: 'manufacturer-product-alias',
            candidate,
        });
    });

    it('should preserve a higher-tier match across rename and reconnect metadata changes', () => {
        const candidate = createCandidate();

        const beforeRename = matchControllerProfile({
            candidates: [candidate],
            connectedIdentity: createConnectedIdentity({ instanceId: 'connection-before-rename' }),
        });
        const afterRename = matchControllerProfile({
            candidates: [candidate],
            connectedIdentity: createConnectedIdentity({
                instanceId: 'connection-after-reconnect',
                manufacturer: 'Renamed Vendor',
                productName: 'Renamed Port',
            }),
        });

        expect(beforeRename).toMatchObject({
            status: 'match',
            basis: 'stable-native-identity',
            candidate,
        });
        expect(afterRename).toEqual({
            status: 'match',
            connectedInstanceId: 'connection-after-reconnect',
            basis: 'stable-native-identity',
            candidate,
        });
    });

    it.each(['Push', 'Push 2 Live', 'Ableton Push 2', 'Push-2'])(
        'should reject the near-name or substring product %s',
        (productName) => {
            const candidate = createCandidate({
                stableNativeIdentities: undefined,
                acceptedSysExIdentityReplies: undefined,
            });

            const result = matchControllerProfile({
                candidates: [candidate],
                connectedIdentity: createConnectedIdentity({
                    fingerprint: undefined,
                    stableNativeIdentity: undefined,
                    sysexIdentityReply: undefined,
                    productName,
                }),
            });

            expect(result).toEqual({
                status: 'no-match',
                connectedInstanceId: 'instance-1',
            });
        }
    );

    it('should return a typed no-match result when there are zero candidates', () => {
        const result = matchControllerProfile({
            candidates: [],
            connectedIdentity: createConnectedIdentity(),
        });

        expect(result).toEqual({
            status: 'no-match',
            connectedInstanceId: 'instance-1',
        });
    });

    it('should expose every candidate tied at the highest matching tier as ambiguity', () => {
        const firstNativeMatch = createCandidate({ profileId: 'z-profile' });
        const secondNativeMatch = createCandidate({ profileId: 'a-profile' });
        const lowerAliasMatch = createCandidate({
            profileId: 'lower-profile',
            stableNativeIdentities: ['usb:not-connected'],
            acceptedSysExIdentityReplies: [[0xf0, 0x01, 0xf7]],
        });

        const result = matchControllerProfile({
            candidates: [firstNativeMatch, lowerAliasMatch, secondNativeMatch],
            connectedIdentity: createConnectedIdentity(),
        });

        expect(result).toEqual({
            status: 'ambiguous',
            connectedInstanceId: 'instance-1',
            basis: 'stable-native-identity',
            candidates: [firstNativeMatch, secondNativeMatch],
        });
    });

    it('should not choose by registration order or profile ID when every top-tier candidate is tied', () => {
        const alphabeticallyLast = createCandidate({ profileId: 'z-profile' });
        const alphabeticallyFirst = createCandidate({ profileId: 'a-profile' });

        const forward = matchControllerProfile({
            candidates: [alphabeticallyLast, alphabeticallyFirst],
            connectedIdentity: createConnectedIdentity(),
        });
        const reverse = matchControllerProfile({
            candidates: [alphabeticallyFirst, alphabeticallyLast],
            connectedIdentity: createConnectedIdentity(),
        });

        expect(forward).toMatchObject({
            status: 'ambiguous',
            candidates: [alphabeticallyLast, alphabeticallyFirst],
        });
        expect(reverse).toMatchObject({
            status: 'ambiguous',
            candidates: [alphabeticallyFirst, alphabeticallyLast],
        });
    });

    it('should retain distinct connected instance identities for two identical controller models', () => {
        const candidate = createCandidate();

        const first = matchControllerProfile({
            candidates: [candidate],
            connectedIdentity: createConnectedIdentity({ instanceId: 'physical-instance-a' }),
        });
        const second = matchControllerProfile({
            candidates: [candidate],
            connectedIdentity: createConnectedIdentity({ instanceId: 'physical-instance-b' }),
        });

        expect(first).toMatchObject({ status: 'match', connectedInstanceId: 'physical-instance-a' });
        expect(second).toMatchObject({ status: 'match', connectedInstanceId: 'physical-instance-b' });
    });

    it.each<{
        name: string;
        input: MatchControllerProfileInput;
        reason: string;
    }>([
        {
            name: 'blank candidate profile identity',
            input: {
                candidates: [createCandidate({ profileId: ' ' })],
                connectedIdentity: createConnectedIdentity(),
            },
            reason: 'invalid-candidate',
        },
        {
            name: 'partial manufacturer metadata',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: createConnectedIdentity({ productName: undefined }),
            },
            reason: 'invalid-connected-identity',
        },
        {
            name: 'out-of-range SysEx byte',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: createConnectedIdentity({ sysexIdentityReply: [0xf0, 256, 0xf7] }),
            },
            reason: 'invalid-connected-identity',
        },
        {
            name: 'blank explicit binding fingerprint',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: createConnectedIdentity(),
                explicitFingerprintBinding: { fingerprint: '', profileId: 'push-2' },
            },
            reason: 'invalid-explicit-binding',
        },
    ])('should fail closed without throwing for $name', ({ input, reason }) => {
        const candidatesBefore = [...input.candidates];

        expect(() => matchControllerProfile(input)).not.toThrow();
        expect(matchControllerProfile(input)).toEqual({
            status: 'invalid-input',
            connectedInstanceId: input.connectedIdentity.instanceId,
            reason,
        });
        expect(input.candidates).toEqual(candidatesBefore);
    });

    it.each<{
        name: string;
        input: unknown;
        connectedInstanceId: string;
        reason: string;
    }>([
        {
            name: 'null root input',
            input: null,
            connectedInstanceId: '',
            reason: 'invalid-connected-identity',
        },
        {
            name: 'missing candidates container',
            input: { connectedIdentity: createConnectedIdentity() },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-candidate',
        },
        {
            name: 'null candidates container',
            input: { candidates: null, connectedIdentity: createConnectedIdentity() },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-candidate',
        },
        {
            name: 'null candidate',
            input: { candidates: [null], connectedIdentity: createConnectedIdentity() },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-candidate',
        },
        {
            name: 'candidate missing profile identity',
            input: {
                candidates: [{ stableNativeIdentities: ['usb:2982:1967'] }],
                connectedIdentity: createConnectedIdentity(),
            },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-candidate',
        },
        {
            name: 'candidate with null native identity container',
            input: {
                candidates: [{ profileId: 'push-2', stableNativeIdentities: null }],
                connectedIdentity: createConnectedIdentity(),
            },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-candidate',
        },
        {
            name: 'missing connected identity container',
            input: { candidates: [createCandidate()] },
            connectedInstanceId: '',
            reason: 'invalid-connected-identity',
        },
        {
            name: 'null connected identity',
            input: { candidates: [createCandidate()], connectedIdentity: null },
            connectedInstanceId: '',
            reason: 'invalid-connected-identity',
        },
        {
            name: 'connected identity missing instance identity',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: { fingerprint: 'fingerprint:push-2:desk' },
            },
            connectedInstanceId: '',
            reason: 'invalid-connected-identity',
        },
        {
            name: 'connected identity with null SysEx container',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: {
                    ...createConnectedIdentity(),
                    sysexIdentityReply: null,
                },
            },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-connected-identity',
        },
        {
            name: 'explicit binding missing profile identity',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: createConnectedIdentity(),
                explicitFingerprintBinding: { fingerprint: 'fingerprint:push-2:desk' },
            },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-explicit-binding',
        },
        {
            name: 'explicit binding with null fingerprint',
            input: {
                candidates: [createCandidate()],
                connectedIdentity: createConnectedIdentity(),
                explicitFingerprintBinding: { fingerprint: null, profileId: 'push-2' },
            },
            connectedInstanceId: 'instance-1',
            reason: 'invalid-explicit-binding',
        },
    ])('should reject malformed runtime input without throwing for $name', ({ input, connectedInstanceId, reason }) => {
        expect(() => matchControllerProfile(input)).not.toThrow();
        expect(matchControllerProfile(input)).toEqual({
            status: 'invalid-input',
            connectedInstanceId,
            reason,
        });
    });
});
