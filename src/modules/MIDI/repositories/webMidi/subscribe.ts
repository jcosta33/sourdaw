import { type WebMidiSubscriber, webMidiSubscribers } from './state';

export function subscribe(callback: WebMidiSubscriber): () => void {
    webMidiSubscribers.add(callback);
    return () => {
        webMidiSubscribers.delete(callback);
    };
}
