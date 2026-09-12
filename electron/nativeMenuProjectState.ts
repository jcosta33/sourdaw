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

/** The longest label a native menu is asked to render for one recent project. */
const MAX_MENU_LABEL_CODE_POINTS = 256;

/**
 * Whether a code point is a C0 or C1 control character (the ranges 0-31 and
 * 127-159), expressed numerically rather than as a regex escape so the source
 * carries no literal control bytes of its own.
 */
const isControlCodePoint = (codePoint: number): boolean =>
    (codePoint >= 0 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159);

/**
 * Bounds an untrusted project string before it reaches a native shell
 * surface: a `Menu` label, a `BrowserWindow` title, or the close-confirmation
 * dialog message.
 *
 * `NATIVE_MENU_PROJECT_STATE_CHANNEL` carries renderer-authored project state
 * straight into `createApplicationMenuTemplate`'s "Open Recent" labels
 * (electron/applicationMenu.ts), `window.setTitle`, and — through
 * `updateCloseState` — `askToSaveBeforeClose`'s dialog message
 * (electron/windowCloseDialog.ts). Without this, a control character or an
 * unbounded length reaches native OS chrome unfiltered.
 */
export const boundShellLabel = (value: string): string =>
    [...value]
        .filter((character) => !isControlCodePoint(character.codePointAt(0) ?? 0))
        .slice(0, MAX_MENU_LABEL_CODE_POINTS)
        .join('');

/** Applies the renderer's validated native-menu projection to shell-owned surfaces. */
export const createNativeMenuProjectStateController = ({
    updateCloseState,
    getWindow,
    rebuildApplicationMenu,
}: CreateNativeMenuProjectStateControllerInput) => {
    let recentProjects: NativeMenuProjectState['recentProjects'] | undefined;
    return {
        apply: (state: NativeMenuProjectState): void => {
            const boundedRecentProjects = state.recentProjects.map((project) => ({
                ...project,
                name: boundShellLabel(project.name),
            }));
            const boundedState: NativeMenuProjectState = {
                ...state,
                title: boundShellLabel(state.title),
                recentProjects: boundedRecentProjects,
            };
            updateCloseState(boundedState);
            const window = getWindow();
            if (window !== undefined && !window.isDestroyed()) {
                window.setTitle(`${boundedState.title} — Sourdaw`);
                window.setDocumentEdited(boundedState.dirty || boundedState.durabilityPending);
            }
            const changed =
                recentProjects === undefined ||
                recentProjects.length !== boundedRecentProjects.length ||
                recentProjects.some(
                    (project, index) =>
                        project.key !== boundedRecentProjects[index]?.key ||
                        project.name !== boundedRecentProjects[index]?.name
                );
            if (changed) {
                recentProjects = boundedRecentProjects;
                rebuildApplicationMenu(boundedRecentProjects);
            }
        },
    };
};
