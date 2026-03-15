/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type MetadataType } from '../models/MetadataType';

type MetadataSnapshot =
    | { type: 'title'; value: string }
    | { type: 'meta'; name: string; value: Nullable<string> }
    | { type: 'link'; rel: string; value: Nullable<string> };

function setMetaTag(name: string, content: string): MetadataSnapshot {
    let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    const previousValue = element ? element.content : null;

    if (!element) {
        element = document.createElement('meta');
        element.name = name;
        document.head.appendChild(element);
    }

    element.content = content;

    return { type: 'meta', name, value: previousValue };
}

function setLinkTag(rel: string, href: string): MetadataSnapshot {
    let element = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    const previousValue = element ? element.href : null;

    if (!element) {
        element = document.createElement('link');
        element.rel = rel;
        document.head.appendChild(element);
    }

    element.href = href;

    return { type: 'link', rel, value: previousValue };
}

function restoreMetadata(snapshots: MetadataSnapshot[]) {
    for (const snapshot of snapshots) {
        if (snapshot.type === 'title') {
            document.title = snapshot.value;
        } else if (snapshot.type === 'meta') {
            const element = document.querySelector<HTMLMetaElement>(`meta[name="${snapshot.name}"]`);
            if (snapshot.value === null) {
                element?.remove();
            } else if (element) {
                element.content = snapshot.value;
            }
        } else if (snapshot.type === 'link') {
            const element = document.querySelector<HTMLLinkElement>(`link[rel="${snapshot.rel}"]`);
            if (snapshot.value === null) {
                element?.remove();
            } else if (element) {
                element.href = snapshot.value;
            }
        }
    }
}

/**
 * Sets the meta tags for the current page.
 * @param meta - The meta tags to set.
 * @returns A function to restore the meta tags to their previous values.
 */
export function setMetadata(meta: MetadataType): () => void {
    const snapshots: MetadataSnapshot[] = [];

    if (meta.title) {
        snapshots.push({ type: 'title', value: document.title });
        document.title = meta.title;
    }

    if (meta.description) {
        snapshots.push(setMetaTag('description', meta.description));
    }

    if (meta.keywords) {
        snapshots.push(setMetaTag('keywords', meta.keywords));
    }

    if (meta.canonical) {
        snapshots.push(setLinkTag('canonical', meta.canonical));
    }

    return () => restoreMetadata(snapshots);
}
