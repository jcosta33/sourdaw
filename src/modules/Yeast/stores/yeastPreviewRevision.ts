type YeastPreviewRevisionDetails = Readonly<{
    processorId: string;
    parameterName: string;
    transient: boolean;
}>;

export type YeastPreviewRevision = YeastPreviewRevisionDetails &
    Readonly<{
        revision: number;
        phase: 'pending' | 'applied';
    }>;

type YeastPreviewRevisionSubscriber = (revision: YeastPreviewRevision) => void;

const subscribers = new Set<YeastPreviewRevisionSubscriber>();
let currentRevision = 0;

function notifySubscribers(revision: YeastPreviewRevision): void {
    for (const subscriber of subscribers) {
        subscriber(revision);
    }
}

export function publishPendingYeastPreviewRevision(input: YeastPreviewRevisionDetails): number {
    if (currentRevision === Number.MAX_SAFE_INTEGER) {
        currentRevision = 1;
    } else {
        currentRevision += 1;
    }
    notifySubscribers({ ...input, revision: currentRevision, phase: 'pending' });
    return currentRevision;
}

export function publishAppliedYeastPreviewRevision(
    input: YeastPreviewRevisionDetails & Readonly<{ revision: number }>
): void {
    notifySubscribers({ ...input, phase: 'applied' });
}

export function subscribeYeastPreviewRevision(subscriber: YeastPreviewRevisionSubscriber): () => void {
    subscribers.add(subscriber);
    return () => {
        subscribers.delete(subscriber);
    };
}
