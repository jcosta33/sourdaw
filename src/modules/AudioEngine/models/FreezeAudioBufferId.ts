const PROJECT_FREEZE_PREFIX = 'freeze-project-';

type CreateFreezeAudioBufferIdInput = {
    projectId: number;
    renderedAt: number;
    trackId: string;
};

type IsFreezeAudioBufferOwnedByProjectInput = {
    bufferId: string;
    projectId: number;
};

function projectFreezePrefix(projectId: number): string {
    return `${PROJECT_FREEZE_PREFIX}${String(projectId)}-`;
}

export function createFreezeAudioBufferId({ projectId, renderedAt, trackId }: CreateFreezeAudioBufferIdInput): string {
    return `${projectFreezePrefix(projectId)}${trackId}-${String(renderedAt)}`;
}

export function isFreezeAudioBufferOwnedByProject({
    bufferId,
    projectId,
}: IsFreezeAudioBufferOwnedByProjectInput): boolean {
    return bufferId.startsWith(projectFreezePrefix(projectId));
}
