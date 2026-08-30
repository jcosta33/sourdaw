let cancellationRequested = false;

/** Coordinates cancellation of one renderer-owned session retirement. */
export const projectSessionQuiesceCancellation = {
    begin: (): void => {
        cancellationRequested = false;
    },
    cancel: (): void => {
        cancellationRequested = true;
    },
    requested: (): boolean => cancellationRequested,
};
