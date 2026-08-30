export type NativeDialogWindow = { readonly isDestroyed: () => boolean };

export type NativeCloseDialog = {
    readonly showMessageBox: (
        window: NativeDialogWindow,
        options: {
            readonly type: 'warning';
            readonly buttons: readonly string[];
            readonly defaultId: number;
            readonly cancelId: number;
            readonly message: string;
            readonly detail: string;
        }
    ) => Promise<{ readonly response: number }>;
};

export type NativeCloseDecision = 'save' | 'discard' | 'cancel';

/** Native loss-warning policy, kept separate from the close state machine. */
export const askToSaveBeforeClose = async ({
    window,
    dialog,
    title,
}: {
    readonly window: NativeDialogWindow | undefined;
    readonly dialog: NativeCloseDialog;
    readonly title: string;
}): Promise<NativeCloseDecision> => {
    if (window === undefined || window.isDestroyed()) {
        return 'cancel';
    }
    const answer = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['Save', 'Don’t Save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Do you want to save the changes you made to “${title}”?`,
        detail: 'Your changes will be lost if you do not save them.',
    });
    if (answer.response === 0) {
        return 'save';
    }
    if (answer.response === 1) {
        return 'discard';
    }
    return 'cancel';
};
