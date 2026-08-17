/**
 * The exposed and denied command sets, re-derived from Rust at test time
 * (AC-003).
 *
 * A list of names copied into TypeScript is only as good as the check that it
 * still matches the thing it mirrors. So nothing here trusts
 * `electron/commands.ts`: the registered surface is read out of
 * `src-tauri/src/lib.rs`'s `generate_handler!`, the allowed surface out of the
 * Tauri capability, and the addon's methods out of the addon's own Rust source.
 * A command added, removed or renamed on the Rust side fails here rather than
 * at the moment a musician invokes it.
 *
 * This is the port of `src/utils/__tests__/agentWebviewSecurity.spec.ts` to the
 * Electron shell. The Tauri spec keeps its own assertions about the Tauri
 * manifest and capability; this one covers what the Electron shell decides.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { addonMethodName, commandChannel, DENIED_COMMANDS, EXPOSED_COMMANDS, isExposedCommand } from '../commands.js';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

const matches = (source: string, pattern: RegExp): string[] =>
    [...source.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

const sorted = (names: readonly string[]): string[] => [...new Set(names)].sort();

/** Every command body the product registers, from the Tauri handler list. */
const registeredCommands = (): string[] =>
    sorted(matches(read('src-tauri/src/lib.rs'), /^\s*commands::[\w:]+::(\w+),$/gmu));

/** Every command the Tauri main webview is granted. */
const allowedCommands = (): string[] =>
    sorted(matches(read('src-tauri/permissions/sourdaw-commands.toml'), /^\s*"(\w+)",$/gmu));

/** Every method the Node addon publishes, from its `#[napi]` items. */
const addonMethods = (): string[] =>
    sorted(
        matches(
            read('crates/sourdaw-native/src/addon/mod.rs'),
            /#\[napi[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*pub (?:async )?fn (\w+)/gu
        )
    );

describe('the Electron command surface', () => {
    it('exposes exactly the commands the Tauri webview is granted', () => {
        // Not a hand-kept number. The Tauri capability is the product's
        // decision about what a renderer may invoke, and the Electron shell
        // exposing a different set would make the two shells different
        // products.
        expect(sorted(EXPOSED_COMMANDS)).toEqual(allowedCommands());
    });

    it('denies exactly the registered commands the capability withholds', () => {
        const registered = registeredCommands();
        const allowed = new Set(allowedCommands());

        expect(sorted(DENIED_COMMANDS)).toEqual(registered.filter((command) => !allowed.has(command)));
    });

    it('accounts for every registered command exactly once', () => {
        // The property that makes the two lists above a partition rather than
        // two independent opinions: a command added to Rust and forgotten here
        // is neither exposed nor denied, and would otherwise pass both checks.
        expect(sorted([...EXPOSED_COMMANDS, ...DENIED_COMMANDS])).toEqual(registeredCommands());
        expect(EXPOSED_COMMANDS.length + DENIED_COMMANDS.length).toBe(registeredCommands().length);
    });

    it('refuses a denied command by name', () => {
        for (const command of DENIED_COMMANDS) {
            expect(isExposedCommand(command)).toBe(false);
        }
        expect(isExposedCommand('scan_plugins')).toBe(true);
        expect(isExposedCommand('')).toBe(false);
        expect(isExposedCommand('__proto__')).toBe(false);
    });

    it('gives a denied command no channel that collides with an exposed one', () => {
        const exposedChannels = new Set(EXPOSED_COMMANDS.map(commandChannel));

        expect(exposedChannels.size).toBe(EXPOSED_COMMANDS.length);
        for (const command of DENIED_COMMANDS) {
            expect(exposedChannels.has(commandChannel(command))).toBe(false);
        }
    });
});

describe('addon method naming', () => {
    it('maps every exposed command onto a method the addon publishes', () => {
        // The addon declares each command as `#[napi] pub fn <command_name>`,
        // so the comparison runs in the Rust naming. What the router then calls
        // is the `camelCase` name napi-rs publishes it under, and that
        // translation is pinned by name in the test below — a translation that
        // was right for most commands and wrong for one would surface as a
        // single command failing at runtime with "not a function".
        const published = new Set(addonMethods());

        expect(published.size).toBeGreaterThan(EXPOSED_COMMANDS.length);
        for (const command of EXPOSED_COMMANDS) {
            expect(published.has(command)).toBe(true);
        }
    });

    it('translates the shapes the surface actually contains', () => {
        expect(addonMethodName('scan_plugins')).toBe('scanPlugins');
        expect(addonMethodName('get_plugin_state_bytes')).toBe('getPluginStateBytes');
        expect(addonMethodName('parse_scl')).toBe('parseScl');
        expect(addonMethodName('write_push2_display')).toBe('writePush2Display');
        expect(addonMethodName('collab_get_document_state')).toBe('collabGetDocumentState');
    });
});
