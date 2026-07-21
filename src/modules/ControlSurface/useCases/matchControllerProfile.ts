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

const normalizeExactName = (value: string): string => {
    return value.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en-US');
};

const isNonBlankName = (value: string): boolean => {
    return normalizeExactName(value).length > 0;
};

const isValidOpaqueIdentity = (value: string): boolean => {
    if (value.length === 0) {
        return false;
    }

    return value.trim() === value;
};

const isValidSysExIdentityReply = (reply: readonly number[]): boolean => {
    if (reply.length < 3) {
        return false;
    }

    if (reply[0] !== 0xf0 || reply[reply.length - 1] !== 0xf7) {
        return false;
    }

    for (const byte of reply) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
            return false;
        }
    }

    return true;
};

const hasValidNativeIdentities = (candidate: ControllerProfileMatchCandidate): boolean => {
    const identities = candidate.stableNativeIdentities;
    if (identities === undefined) {
        return false;
    }

    if (identities.length === 0) {
        return false;
    }

    return identities.every(isValidOpaqueIdentity);
};

const hasValidSysExIdentities = (candidate: ControllerProfileMatchCandidate): boolean => {
    const replies = candidate.acceptedSysExIdentityReplies;
    if (replies === undefined) {
        return false;
    }

    if (replies.length === 0) {
        return false;
    }

    return replies.every(isValidSysExIdentityReply);
};

const hasValidManufacturerAliases = (candidate: ControllerProfileMatchCandidate): boolean => {
    const { manufacturer, productAliases } = candidate;
    if (manufacturer === undefined || productAliases === undefined) {
        return false;
    }

    if (!isNonBlankName(manufacturer) || productAliases.length === 0) {
        return false;
    }

    return productAliases.every(isNonBlankName);
};

const isValidCandidate = (candidate: ControllerProfileMatchCandidate): boolean => {
    if (!isValidOpaqueIdentity(candidate.profileId)) {
        return false;
    }

    const hasNativeIdentities = candidate.stableNativeIdentities !== undefined;
    if (hasNativeIdentities && !hasValidNativeIdentities(candidate)) {
        return false;
    }

    const hasSysExIdentities = candidate.acceptedSysExIdentityReplies !== undefined;
    if (hasSysExIdentities && !hasValidSysExIdentities(candidate)) {
        return false;
    }

    const hasManufacturer = candidate.manufacturer !== undefined;
    const hasProductAliases = candidate.productAliases !== undefined;
    if (hasManufacturer !== hasProductAliases) {
        return false;
    }

    const hasManufacturerAliases = hasManufacturer && hasProductAliases;
    if (hasManufacturerAliases && !hasValidManufacturerAliases(candidate)) {
        return false;
    }

    return hasNativeIdentities || hasSysExIdentities || hasManufacturerAliases;
};

const isValidConnectedIdentity = (identity: ConnectedControllerIdentity): boolean => {
    if (!isValidOpaqueIdentity(identity.instanceId)) {
        return false;
    }

    if (identity.fingerprint !== undefined && !isValidOpaqueIdentity(identity.fingerprint)) {
        return false;
    }

    if (identity.stableNativeIdentity !== undefined && !isValidOpaqueIdentity(identity.stableNativeIdentity)) {
        return false;
    }

    if (identity.sysexIdentityReply !== undefined && !isValidSysExIdentityReply(identity.sysexIdentityReply)) {
        return false;
    }

    const hasManufacturer = identity.manufacturer !== undefined;
    const hasProductName = identity.productName !== undefined;
    if (hasManufacturer !== hasProductName) {
        return false;
    }

    if (identity.manufacturer !== undefined && !isNonBlankName(identity.manufacturer)) {
        return false;
    }

    if (identity.productName !== undefined && !isNonBlankName(identity.productName)) {
        return false;
    }

    return true;
};

const isValidExplicitBinding = (
    binding: ControllerFingerprintBinding,
    identity: ConnectedControllerIdentity
): boolean => {
    if (!isValidOpaqueIdentity(binding.fingerprint)) {
        return false;
    }

    if (!isValidOpaqueIdentity(binding.profileId)) {
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

export const matchControllerProfile = (input: MatchControllerProfileInput): MatchControllerProfileOutput => {
    const { candidates, connectedIdentity, explicitFingerprintBinding } = input;
    const connectedInstanceId = connectedIdentity.instanceId;

    if (!isValidConnectedIdentity(connectedIdentity)) {
        return {
            status: 'invalid-input',
            connectedInstanceId,
            reason: 'invalid-connected-identity',
        };
    }

    if (!candidates.every(isValidCandidate)) {
        return {
            status: 'invalid-input',
            connectedInstanceId,
            reason: 'invalid-candidate',
        };
    }

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
};
