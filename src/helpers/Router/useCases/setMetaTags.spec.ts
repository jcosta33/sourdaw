/* (c) Copyright Frontify Ltd., all rights reserved. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setMetadata } from './setMetaTags';

describe('Meta Tags Helpers', () => {
    const originalTitle = document.title;

    beforeEach(() => {
        document.title = 'Original Title';
        document.head.innerHTML = '';
    });

    afterEach(() => {
        document.title = originalTitle;
        document.head.innerHTML = '';
    });

    describe('setMetaTags', () => {
        it('sets document title when title is provided', () => {
            setMetadata({ title: 'New Title' });

            expect(document.title).toBe('New Title');
        });

        it('does not modify document title when title is not provided', () => {
            document.title = 'Existing Title';

            setMetadata({ description: 'Some description' });

            expect(document.title).toBe('Existing Title');
        });

        it('creates description meta tag when description is provided', () => {
            setMetadata({ description: 'Page description' });

            const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
            expect(meta).not.toBeNull();
            expect(meta?.content).toBe('Page description');
        });

        it('updates existing description meta tag', () => {
            const existingMeta = document.createElement('meta');
            existingMeta.name = 'description';
            existingMeta.content = 'Old description';
            document.head.appendChild(existingMeta);

            setMetadata({ description: 'New description' });

            const metas = document.querySelectorAll('meta[name="description"]');
            expect(metas.length).toBe(1);
            expect((metas[0] as HTMLMetaElement).content).toBe('New description');
        });

        it('creates keywords meta tag when keywords is provided', () => {
            setMetadata({ keywords: 'keyword1, keyword2' });

            const meta = document.querySelector<HTMLMetaElement>('meta[name="keywords"]');
            expect(meta).not.toBeNull();
            expect(meta?.content).toBe('keyword1, keyword2');
        });

        it('creates canonical link tag when canonical is provided', () => {
            setMetadata({ canonical: 'https://frontify.internal/page' });

            const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
            expect(link).not.toBeNull();
            expect(link?.href).toBe('https://frontify.internal/page');
        });

        it('updates existing canonical link tag', () => {
            const existingLink = document.createElement('link');
            existingLink.rel = 'canonical';
            existingLink.href = 'https://frontify.internal/old-url';
            document.head.appendChild(existingLink);

            setMetadata({ canonical: 'https://frontify.internal/new-url' });

            const links = document.querySelectorAll('link[rel="canonical"]');
            expect(links.length).toBe(1);
            expect((links[0] as HTMLLinkElement).href).toBe('https://frontify.internal/new-url');
        });

        it('returns a cleanup function that restores state', () => {
            document.title = 'Before Test Title';
            const cleanup = setMetadata({ title: 'New Title', description: 'Desc' });

            expect(document.title).toBe('New Title');
            expect(document.querySelector('meta[name="description"]')).not.toBeNull();

            cleanup();

            expect(document.title).toBe('Before Test Title');
            expect(document.querySelector('meta[name="description"]')).toBeNull();
        });
    });

    describe('restoreMetaTags (via cleanup function)', () => {
        it('restores document title', () => {
            document.title = 'Before Test Title';
            const cleanup = setMetadata({ title: 'New Title' });
            expect(document.title).toBe('New Title');

            cleanup();
            expect(document.title).toBe('Before Test Title');
        });

        it('removes created meta tags', () => {
            const cleanup = setMetadata({ description: 'New Description' });
            expect(document.querySelector('meta[name="description"]')).not.toBeNull();

            cleanup();
            expect(document.querySelector('meta[name="description"]')).toBeNull();
        });

        it('restores existing meta tags', () => {
            const meta = document.createElement('meta');
            meta.name = 'description';
            meta.content = 'Old Description';
            document.head.appendChild(meta);

            const cleanup = setMetadata({ description: 'New Description' });
            expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(
                'New Description'
            );

            cleanup();
            expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(
                'Old Description'
            );
        });

        it('removes created link tags', () => {
            const cleanup = setMetadata({ canonical: 'https://frontify.internal/page' });
            expect(document.querySelector('link[rel="canonical"]')).not.toBeNull();

            cleanup();
            expect(document.querySelector('link[rel="canonical"]')).toBeNull();
        });

        it('restores existing link tags', () => {
            const link = document.createElement('link');
            link.rel = 'canonical';
            link.href = 'https://frontify.internal/old';
            document.head.appendChild(link);
            const oldHref = link.href;

            const cleanup = setMetadata({ canonical: 'https://frontify.internal/new' });
            expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(
                'https://frontify.internal/new'
            );

            cleanup();
            expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(oldHref);
        });
    });
});
