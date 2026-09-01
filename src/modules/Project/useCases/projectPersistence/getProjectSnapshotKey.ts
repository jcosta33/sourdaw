import { NAMED_PROJECT_KEY_PREFIX } from '../../models/ProjectData';

/** Stable native-menu and persisted-snapshot authority for one project session. */
export const getProjectSnapshotKey = (createdAt: number): string => `${NAMED_PROJECT_KEY_PREFIX}${createdAt}`;
