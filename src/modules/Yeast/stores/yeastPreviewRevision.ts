export type YeastPreviewRevision = Readonly<{
    revision: number;
    processorId: string;
    parameterName: string;
    transient: boolean;
}>;

type YeastPreviewRevisionSubscriber = (revision: YeastPreviewRevision) => void;

const subscribers = new Set<YeastPreviewRevisionSubscriber>();
let currentRevision = 0;

export function publishYeastPreviewRevision(input: Omit<YeastPreviewRevision, 'revision'>): void {
    if (currentRevision === Number.MAX_SAFE_INTEGER) {
        currentRevision = 1;
    } else {
        currentRevision += 1;
    }
    const revision = { ...input, revision: currentRevision };
    for (const subscriber of subscribers) {
        subscriber(revision);
    }
}

export function subscribeYeastPreviewRevision(subscriber: YeastPreviewRevisionSubscriber): () => void {
    subscribers.add(subscriber);
    return () => {
        subscribers.delete(subscriber);
    };
}
