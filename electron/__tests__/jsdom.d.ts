/// <reference lib="dom" />

/** The deliberately small jsdom surface used by webviewSecurity.spec.ts. */
declare module 'jsdom' {
    export class JSDOM {
        constructor(html: string, options: { runScripts: 'dangerously' });
        readonly window: { document: Document };
    }
}
