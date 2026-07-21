export type ControllerProfileMatchCandidate = Readonly<{
    profileId: string;
    stableNativeIdentities?: readonly string[];
    acceptedSysExIdentityReplies?: readonly (readonly number[])[];
    manufacturer?: string;
    productAliases?: readonly string[];
}>;

export type ConnectedControllerIdentity = Readonly<{
    instanceId: string;
    fingerprint?: string;
    stableNativeIdentity?: string;
    sysexIdentityReply?: readonly number[];
    manufacturer?: string;
    productName?: string;
}>;

export type ControllerFingerprintBinding = Readonly<{
    fingerprint: string;
    profileId: string;
}>;

export type ControllerProfileMatchBasis =
    'explicit-fingerprint-binding' | 'stable-native-identity' | 'sysex-identity-reply' | 'manufacturer-product-alias';

export type MatchControllerProfileInvalidReason =
    'invalid-candidate' | 'invalid-connected-identity' | 'invalid-explicit-binding';

export type MatchControllerProfileInput = Readonly<{
    candidates: readonly ControllerProfileMatchCandidate[];
    connectedIdentity: ConnectedControllerIdentity;
    explicitFingerprintBinding?: ControllerFingerprintBinding | null;
}>;

export type MatchControllerProfileOutput =
    | Readonly<{
          status: 'invalid-input';
          connectedInstanceId: string;
          reason: MatchControllerProfileInvalidReason;
      }>
    | Readonly<{
          status: 'no-match';
          connectedInstanceId: string;
      }>
    | Readonly<{
          status: 'match';
          connectedInstanceId: string;
          basis: ControllerProfileMatchBasis;
          candidate: ControllerProfileMatchCandidate;
      }>
    | Readonly<{
          status: 'ambiguous';
          connectedInstanceId: string;
          basis: ControllerProfileMatchBasis;
          candidates: readonly ControllerProfileMatchCandidate[];
      }>;

type SuccessfulTierResult = Extract<MatchControllerProfileOutput, { status: 'match' | 'ambiguous' }>;
type UnknownRecord = Readonly<Record<string, unknown>>;

const isUnknownRecord = (value: unknown): value is UnknownRecord => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return !Array.isArray(value);
};

const isUnknownArray = (value: unknown): value is readonly unknown[] => {
    return Array.isArray(value);
};

const normalizeExactName = (value: string): string => {
    return value.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en-US');
};

const isNonBlankName = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    return normalizeExactName(value).length > 0;
};

const isValidOpaqueIdentity = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    if (value.length === 0) {
        return false;
    }

    return value.trim() === value;
};

const isValidSysExIdentityReply = (reply: unknown): reply is readonly number[] => {
    if (!isUnknownArray(reply)) {
        return false;
    }

    if (reply.length < 3) {
        return false;
    }

    if (reply[0] !== 0xf0 || reply[reply.length - 1] !== 0xf7) {
        return false;
    }

    for (const byte of reply) {
        if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 0xff) {
            return false;
        }
    }

    return true;
};

const isValidCandidate = (value: unknown): value is ControllerProfileMatchCandidate => {
    if (!isUnknownRecord(value)) {
        return false;
    }

    if (!isValidOpaqueIdentity(value.profileId)) {
        return false;
    }

    const stableNativeIdentities = value.stableNativeIdentities;
    const hasNativeIdentities = stableNativeIdentities !== undefined;
    if (hasNativeIdentities) {
        if (!isUnknownArray(stableNativeIdentities) || stableNativeIdentities.length === 0) {
            return false;
        }

        if (!stableNativeIdentities.every(isValidOpaqueIdentity)) {
            return false;
        }
    }

    const acceptedSysExIdentityReplies = value.acceptedSysExIdentityReplies;
    const hasSysExIdentities = acceptedSysExIdentityReplies !== undefined;
    if (hasSysExIdentities) {
        if (!isUnknownArray(acceptedSysExIdentityReplies) || acceptedSysExIdentityReplies.length === 0) {
            return false;
        }

        if (!acceptedSysExIdentityReplies.every(isValidSysExIdentityReply)) {
            return false;
        }
    }

    const manufacturer = value.manufacturer;
    const productAliases = value.productAliases;
    const hasManufacturer = manufacturer !== undefined;
    const hasProductAliases = productAliases !== undefined;
    if (hasManufacturer !== hasProductAliases) {
        return false;
    }

    const hasManufacturerAliases = hasManufacturer && hasProductAliases;
    if (hasManufacturerAliases) {
        if (!isNonBlankName(manufacturer)) {
            return false;
        }

        if (!isUnknownArray(productAliases) || productAliases.length === 0) {
            return false;
        }

        if (!productAliases.every(isNonBlankName)) {
            return false;
        }
    }

    return hasNativeIdentities || hasSysExIdentities || hasManufacturerAliases;
};

const isValidCandidateArray = (value: unknown): value is readonly ControllerProfileMatchCandidate[] => {
    if (!isUnknownArray(value)) {
        return false;
    }

    return value.every(isValidCandidate);
};

const isValidConnectedIdentity = (value: unknown): value is ConnectedControllerIdentity => {
    if (!isUnknownRecord(value)) {
        return false;
    }

    if (!isValidOpaqueIdentity(value.instanceId)) {
        return false;
    }

    if (value.fingerprint !== undefined && !isValidOpaqueIdentity(value.fingerprint)) {
        return false;
    }

    if (value.stableNativeIdentity !== undefined && !isValidOpaqueIdentity(value.stableNativeIdentity)) {
        return false;
    }

    if (value.sysexIdentityReply !== undefined && !isValidSysExIdentityReply(value.sysexIdentityReply)) {
        return false;
    }

    const hasManufacturer = value.manufacturer !== undefined;
    const hasProductName = value.productName !== undefined;
    if (hasManufacturer !== hasProductName) {
        return false;
    }

    if (value.manufacturer !== undefined && !isNonBlankName(value.manufacturer)) {
        return false;
    }

    if (value.productName !== undefined && !isNonBlankName(value.productName)) {
        return false;
    }

    return true;
};

const isValidExplicitBinding = (
    value: unknown,
    identity: ConnectedControllerIdentity
): value is ControllerFingerprintBinding => {
    if (!isUnknownRecord(value)) {
        return false;
    }

    if (!isValidOpaqueIdentity(value.fingerprint)) {
        return false;
    }

    if (!isValidOpaqueIdentity(value.profileId)) {
        return false;
    }

    return identity.fingerprint !== undefined;
};

const repliesAreEqual = (left: readonly number[], right: readonly number[]): boolean => {
    if (left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
};

const resolveTier = ({
    basis,
    connectedInstanceId,
    matches,
}: {
    basis: ControllerProfileMatchBasis;
    connectedInstanceId: string;
    matches: readonly ControllerProfileMatchCandidate[];
}): SuccessfulTierResult | null => {
    const candidate = matches[0];
    if (candidate === undefined) {
        return null;
    }

    if (matches.length === 1) {
        return {
            status: 'match',
            connectedInstanceId,
            basis,
            candidate,
        };
    }

    return {
        status: 'ambiguous',
        connectedInstanceId,
        basis,
        candidates: matches,
    };
};

const matchesManufacturerAlias = (
    candidate: ControllerProfileMatchCandidate,
    manufacturer: string,
    productName: string
): boolean => {
    if (candidate.manufacturer === undefined || candidate.productAliases === undefined) {
        return false;
    }

    if (normalizeExactName(candidate.manufacturer) !== manufacturer) {
        return false;
    }

    return candidate.productAliases.some((alias) => normalizeExactName(alias) === productName);
};

export function matchControllerProfile(input: unknown): MatchControllerProfileOutput;
export function matchControllerProfile(input: MatchControllerProfileInput): MatchControllerProfileOutput;
export function matchControllerProfile(input: unknown): MatchControllerProfileOutput {
    if (!isUnknownRecord(input)) {
        return {
            status: 'invalid-input',
            connectedInstanceId: '',
            reason: 'invalid-connected-identity',
        };
    }

    const connectedIdentityInput = input.connectedIdentity;
    let connectedInstanceId = '';
    if (isUnknownRecord(connectedIdentityInput) && typeof connectedIdentityInput.instanceId === 'string') {
        connectedInstanceId = connectedIdentityInput.instanceId;
    }

    if (!isValidConnectedIdentity(connectedIdentityInput)) {
        return {
            status: 'invalid-input',
            connectedInstanceId,
            reason: 'invalid-connected-identity',
        };
    }
    const connectedIdentity = connectedIdentityInput;

    const candidatesInput = input.candidates;
    if (!isValidCandidateArray(candidatesInput)) {
        return {
            status: 'invalid-input',
            connectedInstanceId,
            reason: 'invalid-candidate',
        };
    }
    const candidates = candidatesInput;

    const explicitFingerprintBinding = input.explicitFingerprintBinding;

    if (
        explicitFingerprintBinding !== undefined &&
        explicitFingerprintBinding !== null &&
        !isValidExplicitBinding(explicitFingerprintBinding, connectedIdentity)
    ) {
        return {
            status: 'invalid-input',
            connectedInstanceId,
            reason: 'invalid-explicit-binding',
        };
    }

    if (
        explicitFingerprintBinding !== undefined &&
        explicitFingerprintBinding !== null &&
        explicitFingerprintBinding.fingerprint === connectedIdentity.fingerprint
    ) {
        const matches = candidates.filter((candidate) => candidate.profileId === explicitFingerprintBinding.profileId);
        const result = resolveTier({
            basis: 'explicit-fingerprint-binding',
            connectedInstanceId,
            matches,
        });
        if (result !== null) {
            return result;
        }

        return { status: 'no-match', connectedInstanceId };
    }

    if (connectedIdentity.stableNativeIdentity !== undefined) {
        const stableNativeIdentity = connectedIdentity.stableNativeIdentity;
        const matches = candidates.filter((candidate) => {
            if (candidate.stableNativeIdentities === undefined) {
                return false;
            }

            return candidate.stableNativeIdentities.includes(stableNativeIdentity);
        });
        const result = resolveTier({
            basis: 'stable-native-identity',
            connectedInstanceId,
            matches,
        });
        if (result !== null) {
            return result;
        }
    }

    if (connectedIdentity.sysexIdentityReply !== undefined) {
        const sysexIdentityReply = connectedIdentity.sysexIdentityReply;
        const matches = candidates.filter((candidate) => {
            if (candidate.acceptedSysExIdentityReplies === undefined) {
                return false;
            }

            return candidate.acceptedSysExIdentityReplies.some((reply) => repliesAreEqual(reply, sysexIdentityReply));
        });
        const result = resolveTier({
            basis: 'sysex-identity-reply',
            connectedInstanceId,
            matches,
        });
        if (result !== null) {
            return result;
        }
    }

    if (connectedIdentity.manufacturer !== undefined && connectedIdentity.productName !== undefined) {
        const manufacturer = normalizeExactName(connectedIdentity.manufacturer);
        const productName = normalizeExactName(connectedIdentity.productName);
        const matches = candidates.filter((candidate) =>
            matchesManufacturerAlias(candidate, manufacturer, productName)
        );
        const result = resolveTier({
            basis: 'manufacturer-product-alias',
            connectedInstanceId,
            matches,
        });
        if (result !== null) {
            return result;
        }
    }

    return { status: 'no-match', connectedInstanceId };
}
