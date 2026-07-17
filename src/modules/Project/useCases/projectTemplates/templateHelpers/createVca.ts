import type { Track } from '#/modules/Arrangement/stores';

// Owned here — `createVca` mints the handle; `commitVcaGroups` and
// `finalizeTemplate` type-import it.
export type VcaGroupHandle = {
    id: string;
    name: string;
    memberTrackIds: string[];
};

type CreateVcaInput = {
    name: string;
    members?: Track[];
};

export function createVca(input: CreateVcaInput): VcaGroupHandle {
    const id = `vca-${crypto.randomUUID()}`;
    const handle: VcaGroupHandle = {
        id,
        name: input.name,
        memberTrackIds: (input.members ?? []).map((track) => track.id),
    };
    return handle;
}
