import type { Track } from '#/modules/Arrangement/stores';
import type { VcaGroupHandle } from './builderTypes';

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
