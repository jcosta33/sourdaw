type RenderRequestCancellationLease = {
    signal: AbortSignal;
    dispose: () => void;
};

type RenderRequestCancellationOwner = {
    controller: AbortController;
    detachCaller: () => void;
    phraseId: string;
};

const owners = new Map<string, RenderRequestCancellationOwner>();

function cancellationError(): DOMException {
    return new DOMException('Render cancelled', 'AbortError');
}

/** Owns render cancellation outside project state for exactly one request lifetime. */
export const renderRequestCancellation = {
    own(phraseId: string, requestId: string, callerSignal?: AbortSignal): RenderRequestCancellationLease {
        if (owners.has(requestId)) {
            throw new Error(`Render cancellation is already owned: ${requestId}`);
        }
        const controller = new AbortController();
        const abortFromCaller = (): void => {
            if (!controller.signal.aborted) {
                controller.abort(callerSignal?.reason ?? cancellationError());
            }
        };
        if (callerSignal?.aborted) {
            abortFromCaller();
        } else {
            callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
        }
        const owner: RenderRequestCancellationOwner = {
            controller,
            detachCaller: () => callerSignal?.removeEventListener('abort', abortFromCaller),
            phraseId,
        };
        owners.set(requestId, owner);
        let disposed = false;
        return {
            signal: controller.signal,
            dispose: () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                owner.detachCaller();
                if (owners.get(requestId) === owner) {
                    owners.delete(requestId);
                }
            },
        };
    },

    cancel(phraseId: string, requestId: string): boolean {
        const owner = owners.get(requestId);
        if (owner === undefined || owner.phraseId !== phraseId) {
            return false;
        }
        if (!owner.controller.signal.aborted) {
            owner.controller.abort(cancellationError());
        }
        return true;
    },
};
