import type { NativeMenuProjectState } from './appIpc.js';

export type NativeMenuProjectStateWindow = {
    readonly isDestroyed: () => boolean;
    readonly setTitle: (title: string) => void;
    readonly setDocumentEdited: (edited: boolean) => void;
};

type CreateNativeMenuProjectStateControllerInput = {
    readonly updateCloseState: (state: NativeMenuProjectState) => void;
    readonly getWindow: () => NativeMenuProjectStateWindow | undefined;
    readonly rebuildApplicationMenu: (recentProjects: NativeMenuProjectState['recentProjects']) => void;
};

/** Applies the renderer's validated native-menu projection to shell-owned surfaces. */
export const createNativeMenuProjectStateController = ({
    updateCloseState,
    getWindow,
    rebuildApplicationMenu,
}: CreateNativeMenuProjectStateControllerInput) => {
    let recentProjects: NativeMenuProjectState['recentProjects'] | undefined;
    return {
        apply: (state: NativeMenuProjectState): void => {
            updateCloseState(state);
            const window = getWindow();
            if (window !== undefined && !window.isDestroyed()) {
                window.setTitle(`${state.title} — Sourdaw`);
                window.setDocumentEdited(state.dirty || state.durabilityPending);
            }
            const changed =
                recentProjects === undefined ||
                recentProjects.length !== state.recentProjects.length ||
                recentProjects.some(
                    (project, index) =>
                        project.key !== state.recentProjects[index]?.key ||
                        project.name !== state.recentProjects[index]?.name
                );
            if (changed) {
                recentProjects = state.recentProjects;
                rebuildApplicationMenu(state.recentProjects);
            }
        },
    };
};
