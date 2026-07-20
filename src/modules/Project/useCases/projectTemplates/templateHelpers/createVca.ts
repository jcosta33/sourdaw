// Owned here — `createVca` mints the handle; `commitVcaGroups` and
// `finalizeTemplate` type-import it.
export type VcaGroupHandle = {
    id: string;
    name: string;
    memberTrackIds: string[];
    color: string;
    gain: number;
    muted: boolean;
    soloed: boolean;
};

type CreateVcaInput = {
    name: string;
    members?: ReadonlyArray<{ id: string }>;
    color?: string;
    gain?: number;
    muted?: boolean;
    soloed?: boolean;
};

export function createVca(input: CreateVcaInput): VcaGroupHandle {
    const id = `vca-${crypto.randomUUID()}`;
    const handle: VcaGroupHandle = {
        id,
        name: input.name,
        memberTrackIds: (input.members ?? []).map((track) => track.id),
        color: input.color ?? '',
        gain: input.gain ?? 1,
        muted: input.muted ?? false,
        soloed: input.soloed ?? false,
    };
    return handle;
}
