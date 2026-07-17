import { createTrack } from '#/modules/Arrangement/useCases';

import type { Track } from '#/modules/Arrangement/stores';

type CreateFolderInput = {
    name: string;
    color?: string;
    collapsed?: boolean;
    parentId?: string;
};

export function createFolder(input: CreateFolderInput): Track {
    const folder = createTrack({ name: input.name, kind: 'folder', parentId: input.parentId });
    if (input.color !== undefined) {
        folder.color = input.color;
    }
    if (input.collapsed !== undefined) {
        folder.collapsed = input.collapsed;
    }
    return folder;
}
