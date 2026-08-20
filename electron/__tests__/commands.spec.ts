/**
 * The exposed and denied command sets, re-derived from Rust at test time
 * (AC-003).
 *
 * A list of names copied into TypeScript is only as good as the check that it
 * still matches the thing it mirrors. So the registered surface is not taken
 * from `electron/commands.ts` at its word: it is re-derived from the addon's
 * own `#[napi]` items in `crates/sourdaw-native/src/addon/mod.rs`. A command
 * added, removed or renamed on the Rust side fails here rather than at the
 * moment a musician invokes it.
 *
 * Which registered commands the renderer may invoke is the product decision
 * `EXPOSED_COMMANDS` records — there is no second manifest to derive it from.
 * What is enforced here instead is the partition: every registered command is
 * deliberately exposed or deliberately denied, never silently neither, and
 * every exposed command has a production caller, so the surface never widens
 * ahead of a real need.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Relative on purpose: this project resolves as Node ESM, where `#/*` is the
// package-imports namespace, not the renderer's bundler alias.
import { SOURDAW_COMMAND_ARGUMENTS } from '../../src/utils/sourdawCommandArguments.js';
import { addonMethodName, commandChannel, DENIED_COMMANDS, EXPOSED_COMMANDS, isExposedCommand } from '../commands.js';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

const matches = (source: string, pattern: RegExp): string[] =>
    [...source.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

const sorted = (names: readonly string[]): string[] => [...new Set(names)].sort();

/** Every method the Node addon publishes, from its `#[napi]` items. */
const addonMethods = (): string[] =>
    sorted(
        matches(
            read('crates/sourdaw-native/src/addon/mod.rs'),
            /#\[napi[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*pub (?:async )?fn (\w+)/gu
        )
    );

/**
 * `#[napi]` items that are shell plumbing, not renderer-invokable commands:
 * the scan-worker process entry point, the engine's constructor and shutdown,
 * and the plugin-window host registration the shell itself performs. Pinned
 * by name so a new addon method lands in the registered set by default and
 * must be triaged here explicitly to escape the exposed/denied partition.
 */
const ADDON_PLUMBING: ReadonlySet<string> = new Set([
    'new',
    'notify_plugin_window_closed',
    'register_plugin_window_host',
    'run_plugin_scan_worker',
    'shutdown',
]);

/** Every command the product registers: the addon surface minus plumbing. */
const registeredCommands = (): string[] => addonMethods().filter((name) => !ADDON_PLUMBING.has(name));

/**
 * Every production TypeScript source under a directory, concatenated. Specs,
 * stories and E2E files are excluded: a command whose only mention is a test
 * has no caller.
 */
const readProductionTypescript = (directory: string): string =>
    readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.name !== '__tests__' && entry.name !== 'out')
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                return [readProductionTypescript(path)];
            }
            if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
                return [];
            }
            if (entry.name.includes('.spec.') || entry.name.includes('.stories.') || entry.name.includes('.e2e.')) {
                return [];
            }
            return [readFileSync(path, 'utf8')];
        })
        .join('\n');

describe('the Electron command surface', () => {
    it('pins only plumbing names the addon actually publishes', () => {
        // A renamed plumbing method would otherwise fall into the registered
        // set as a phantom new command, and the stale pin would keep excusing
        // a name that no longer exists.
        const published = new Set(addonMethods());
        for (const name of ADDON_PLUMBING) {
            expect(published.has(name)).toBe(true);
        }
    });

    it('grants only commands with a production caller', () => {
        // The capability file died with the Tauri shell, so minimality is the
        // check that remains: an exposed command nothing in `src/` invokes is
        // pure attack surface and fails here until a caller exists.
        //
        // A string mention is a weak proxy for a caller (jcosta33/sourdaw#2221):
        // this check passes on any quoted occurrence, reachable or not. An
        // exposure therefore also needs the call chain verified by hand and
        // recorded in the exposing commit.
        const productionSource = readProductionTypescript('src');
        for (const command of EXPOSED_COMMANDS) {
            expect(productionSource, `no production caller for '${command}'`).toMatch(
                new RegExp(`["']${command}["']`, 'u')
            );
        }
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

    it('keeps shell runtime code out of the renderer tree', () => {
        // Only the specs may import from `src/` (this file cross-checks the
        // renderer's seam table). `electron/tsconfig.json` maps `#/*` for that
        // spec-only use; this pin is what keeps the mapping from becoming a
        // runtime dependency on the renderer bundle.
        const shellSource = readProductionTypescript('electron');

        expect(shellSource).not.toMatch(/from\s+'#\//u);
        expect(shellSource).not.toMatch(/from\s+'\.\.\/src\//u);
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

    it('publishes the plugin-window host methods the shell registers against', () => {
        // pluginGui.ts dereferences these by their napi camelCase names, and
        // its deliberate stale-addon tolerance turns a rename into silently
        // unavailable plugin editors rather than a failing test — so the
        // names are pinned here against the Rust source.
        const published = new Set(addonMethods());

        expect(published.has('register_plugin_window_host')).toBe(true);
        expect(published.has('notify_plugin_window_closed')).toBe(true);
        expect(addonMethodName('register_plugin_window_host')).toBe('registerPluginWindowHost');
        expect(addonMethodName('notify_plugin_window_closed')).toBe('notifyPluginWindowClosed');
    });

    it('translates the shapes the surface actually contains', () => {
        expect(addonMethodName('scan_plugins')).toBe('scanPlugins');
        expect(addonMethodName('get_plugin_state_bytes')).toBe('getPluginStateBytes');
        expect(addonMethodName('parse_scl')).toBe('parseScl');
        expect(addonMethodName('write_push2_display')).toBe('writePush2Display');
        expect(addonMethodName('collab_get_document_state')).toBe('collabGetDocumentState');
    });
});

/**
 * The parameter list of one `#[napi]` method, in declaration order.
 *
 * Parsed by bracket depth rather than by regex: several signatures wrap across
 * lines and carry generic types (`Option<String>`, `Vec<String>`), and a
 * line-anchored pattern would silently return a short list for exactly those.
 */
type AddonSignature = {
    readonly parameters: readonly string[];
    readonly streamEmitter: boolean;
};

const addonSignatures = (): ReadonlyMap<string, AddonSignature> => {
    const source = read('crates/sourdaw-native/src/addon/mod.rs');
    const signatures = new Map<string, AddonSignature>();
    const declaration = /#\[napi[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*pub (?:async )?fn (\w+)\s*\(/gu;

    for (const match of source.matchAll(declaration)) {
        const name = match[1];
        if (name === undefined) {
            continue;
        }
        const start = match.index + match[0].length;
        let cursor = start;
        let depth = 1;
        while (cursor < source.length && depth > 0) {
            const character = source[cursor];
            if (character === '(' || character === '<' || character === '[') {
                depth += 1;
            } else if (character === ')' || character === '>' || character === ']') {
                depth -= 1;
            }
            cursor += 1;
        }

        const declared: string[] = [];
        let nesting = 0;
        let current = '';
        for (const character of source.slice(start, cursor - 1)) {
            if (character === '<' || character === '(' || character === '[') {
                nesting += 1;
            }
            if (character === '>' || character === ')' || character === ']') {
                nesting -= 1;
            }
            if (character === ',' && nesting === 0) {
                declared.push(current);
                current = '';
            } else {
                current += character;
            }
        }
        declared.push(current);

        const named = declared
            .map((parameter) => parameter.trim())
            .filter((parameter) => parameter !== '' && parameter !== '&self' && parameter !== 'self')
            .map((parameter) => parameter.slice(0, parameter.indexOf(':')).trim());

        signatures.set(name, {
            // The router appends the emitter itself; it is never sent by a caller.
            parameters: named.filter((parameter) => parameter !== 'on_event'),
            streamEmitter: named.includes('on_event'),
        });
    }
    return signatures;
};

/**
 * What each exposed command's positional arguments are, in order.
 *
 * `SourdawBridge` takes a positional array, so this order *is* the contract
 * every renderer call site is written against. Under Tauri's named-argument
 * `invoke` a transposition was unrepresentable; here `load_plugin(plugin_id,
 * instance_id)` and `provider_gateway_request`'s five consecutive `String`
 * parameters would be accepted swapped by napi-rs deserialization without a
 * word, and surface as a plugin that will not load or a request signed with the
 * wrong key.
 *
 * Written out rather than derived on both sides: a derivation compared against
 * itself asserts nothing. The equality below is what makes a Rust signature
 * change fail here instead of at a musician's first invoke.
 */
const COMMAND_ARGUMENTS: ReadonlyMap<string, readonly string[]> = new Map([
    ['analyze_pitch', ['analysis_id', 'audio_path']],
    ['arm_recording', ['instance_id', 'threshold', 'target_pad', 'max_duration_secs']],
    ['cancel_provider_gateway_request', ['request_id']],
    ['close_midi_input', []],
    ['close_plugin_gui', ['instance_id']],
    ['close_provider_gateway_session', ['session_id']],
    ['close_push_transport', []],
    ['collab_apply_change', ['doc_id', 'change_bytes']],
    ['collab_create_project', ['name', 'sample_rate']],
    ['collab_get_document_state', ['doc_id']],
    ['collab_load_bundle', ['path']],
    ['collab_merge_bundle', ['path']],
    ['collab_save_bundle', ['path']],
    ['commit_pitch_edit', ['request']],
    ['create_crumbs', ['instance_id', 'sample_rate']],
    ['crumbs_all_sound_off', ['instance_id']],
    ['crumbs_note_off', ['instance_id', 'note']],
    ['crumbs_note_on', ['instance_id', 'note', 'velocity']],
    ['denoise_audio', ['request']],
    ['destroy_crumbs', ['instance_id']],
    ['detect_onsets', ['instance_id', 'sample_id', 'algorithm']],
    ['detect_smart_loop_points', ['instance_id', 'sample_id']],
    ['disable_link', []],
    ['enable_link', []],
    ['engine_rt_diagnostics', []],
    ['ensure_whisper_ready', []],
    ['get_crumbs_position', ['instance_id']],
    ['get_default_plugin_paths', []],
    ['get_link_status', []],
    ['get_plugin_parameters', ['instance_id']],
    ['get_plugin_state_bytes', ['instance_id']],
    ['get_waveform_peaks', ['instance_id', 'sample_id', 'level', 'channel']],
    ['is_plugin_gui_supported', ['instance_id']],
    ['link_start_playing', []],
    ['link_stop_playing', []],
    ['list_directory', ['path']],
    ['list_midi_inputs', []],
    ['load_plugin', ['plugin_id', 'instance_id']],
    ['load_sample', ['instance_id', 'file_path']],
    ['map_graph_batch', ['prior', 'batch', 'sample_rate', 'session']],
    ['open_midi_input', ['port_index']],
    ['open_plugin_gui', ['instance_id']],
    ['open_provider_gateway_session', ['adapter_id', 'origin', 'credential_source']],
    ['open_push_transport', ['model']],
    ['parse_scl', ['content', 'root_note', 'root_freq']],
    ['process_plugin_audio', ['instance_id', 'audio_bytes']],
    ['provider_gateway_request', ['request_id', 'session_id', 'operation', 'body']],
    ['read_file_bytes', ['path']],
    ['register_timeline_sample', ['sample_id', 'sample_rate', 'channels', 'pcm']],
    ['render_graph_offline', ['batch', 'frames', 'sample_rate']],
    ['scan_plugins', ['paths']],
    ['send_push_midi', ['bytes']],
    ['set_crumbs_mode', ['instance_id', 'mode']],
    ['set_crumbs_param', ['instance_id', 'param', 'value']],
    ['set_link_tempo', ['tempo']],
    ['set_plugin_bypass', ['instance_id', 'bypassed']],
    ['set_plugin_parameter', ['instance_id', 'param_id', 'value']],
    ['set_plugin_state_bytes', ['instance_id', 'plugin_state']],
    ['start_dictation', []],
    ['stop_dictation', []],
    ['stop_recording', ['instance_id']],
    ['unload_plugin', ['instance_id']],
    ['write_file_bytes', ['path', 'data']],
    ['write_push2_display', ['bytes']],
]);

describe('positional argument contract', () => {
    it('matches the addon signature for every exposed command, in order', () => {
        const signatures = addonSignatures();
        const derived = EXPOSED_COMMANDS.map((command): [string, readonly string[]] => [
            command,
            signatures.get(command)?.parameters ?? ['<no signature found>'],
        ]);

        expect(derived).toEqual([...COMMAND_ARGUMENTS.entries()].sort(([a], [b]) => a.localeCompare(b)));
    });

    it('pins the runs of same-typed parameters a transposition would hide', () => {
        // Named explicitly because these are the two the parity risk is real
        // for: everything in them is a `String`, so nothing downstream rejects
        // a swap.
        expect(COMMAND_ARGUMENTS.get('load_plugin')).toEqual(['plugin_id', 'instance_id']);
        expect(COMMAND_ARGUMENTS.get('provider_gateway_request')).toEqual([
            'request_id',
            'session_id',
            'operation',
            'body',
        ]);
    });

    it('matches the renderer seam table, so the seam orders arguments by the same contract', () => {
        // The renderer cannot import `electron/**`, so the seam keeps its own
        // copy of this table; this equality is what keeps the copy honest.
        const bySortedName = (entries: ReadonlyMap<string, readonly string[]>): [string, readonly string[]][] =>
            [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));

        expect(bySortedName(SOURDAW_COMMAND_ARGUMENTS)).toEqual(bySortedName(COMMAND_ARGUMENTS));
    });

    it('reserves the trailing emitter for exactly the streaming commands', () => {
        // The router appends `stream.emit` as the final argument, so a command
        // that grew an emitter without the renderer calling `stream()` would be
        // invoked one argument short.
        const streaming = [...addonSignatures()]
            .filter(([name, signature]) => signature.streamEmitter && isExposedCommand(name))
            .map(([name]) => name);

        expect(streaming).toEqual(['provider_gateway_request']);
    });
});
