/** Execute the bounded genuine-source consumers and refuse silent zero/ignored admission. */
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type FixturePlatform = 'linux' | 'macos' | 'windows';

export const EXPECTED_REJECTIONS = [
    'num_enum_duplicate_alternatives',
    'num_enum_invalid_repr',
    'tracing_unknown_skip',
    'tracing_unsafe_to_safe',
    'visibility_unsafe_to_safe',
    'visibility_unsupported_impl',
] as const;

export const EXPECTED_RUST_CASES = {
    macros: [
        'complete_macro_definition_rejects_the_actual_trailing_slice',
        'float_exponent_and_width_keep_the_same_value',
        'functional_macro_keeps_argument_order_and_remainder',
        'integer_boundary_wraps_u64_max_and_rejects_overflow',
        'malformed_float_exponents_are_rejected',
        'partial_parse_returns_the_original_unconsumed_token_slice',
        'string_literal_keeps_unicode_and_raw_escape_bytes',
        'token_precedence_keeps_multiplication_and_parentheses',
        'unknown_identifier_preserves_the_original_error_input',
        'alternatives_preserve_closed_bounds_and_reject_the_gap',
        'default_and_into_primitive_keep_the_declared_discriminants',
        'signed_implicit_and_explicit_discriminants_preserve_values',
        'async_expansion_records_the_polled_body_and_return_value',
        'parsed_async_block_preserves_match_guard_semantics',
        'sync_expansion_preserves_safety_fields_skip_and_return_event',
        'changed_visibility_exposes_the_original_function_and_fields',
        'unsafe_function_still_has_an_unsafe_signature',
    ],
    headers: [
        'tests::context_layout_matches_the_actual_c_header',
        'tests::generated_encoder_callback_alias_crosses_the_real_c_abi',
        'tests::token_layout_matches_the_actual_c_header',
        'source_refresh_tests::source_refresh_replaces_changed_headers_and_removes_deleted_inputs',
    ],
    loader: ['tests::actual_loader_releases_failed_entries_before_unloading_their_library'],
    public: [
        'actual_host_empty_change_after_maximum_preserves_header_and_only_empty_query',
        'actual_host_maximum_counter_save_load_bundle_and_seek',
        'stable_canonical_wire_uses_independent_leb_rle_bytes',
        'stable_concurrent_merge_and_bundle_preserve_change_bytes_and_metadata',
        'stable_delta_refuses_absolute_overflow_and_preserves_signed_values',
        'stable_automerge_raw_values_survive_replace_delete_save_and_reload',
        'stable_maximum_counter_bundle_uses_actual_host_width_without_wrap',
        'stable_original_alpha_document_change_bundle_bytes_and_reads',
        'stable_pack_checks_bounds_without_rejecting_empty_or_exact_eof',
        'stable_raw_reader_checks_overflow_and_retains_empty_eof',
        'stable_mark_prefixes_survive_many_boundaries_actor_remap_and_rollback',
        'stable_delta_load_predicate_observes_absolute_interior_values',
        'stable_plain_signed_rle_values_do_not_accumulate_as_deltas',
        'stable_typed_delta_seek_reads_absolutes_for_null_negative_zero_and_extrema',
        'stable_valid_near_i64_extrema_preserve_byte_encoding',
        'stable_valid_wide_delta_displacement_survives_save_and_splice',
        'stable_automerge_full_signed_timestamp_route_saves_reloads_and_preserves_hashes',
    ],
    private: [
        'change_graph::root_port_column_tests::root_port_change_iterator_nth_keeps_metadata_rows_and_absolute_extra_prefix',
        'op_set2::columnar::root_port_weight_tests::root_port_counter_signed_null_zero_max_and_sparse_visits',
        'op_set2::op_set::mark_index::root_port_weight_tests::root_port_mark_weight_multi_node_split_delete_remap_and_undo',
        'op_set2::op_set::op_iter::tests::root_port_counter_inclusive_maximum_merges_id_successor_rows_and_empty_headers',
        'op_set2::meta::root_port_weight_tests::root_port_value_meta_wide_split_delete_reweight_and_rejection',
    ],
    dev: [
        'root_port_logging_macro_rejects_unsupported_function_modifier',
        'root_port_latest_terminal_table_and_logging_macro_keep_output',
    ],
    paired: ['op_set2::op_set::op_iter::tests::obj_id_iter_seek', 'op_set2::op_set::op_iter::tests::skip_op_ids'],
    windows: [
        'callback_borrows_exact_operation_without_retaining_it',
        'callback_null_operation_returns_e_pointer_through_generated_vtable',
        'outref_returns_exact_unknown_with_independent_owned_lifetime',
        'outref_preserves_failed_activation_hresult_separately_from_method_success',
        'outref_propagates_method_failure_without_replacing_output_slots',
        'outref_null_slot_returns_e_pointer_without_leaking_the_output_clone',
        'scalar_delegate_receives_copy_type_values_through_generated_invoke',
        'hstring_delegate_borrows_clone_type_and_can_retain_an_owned_clone',
    ],
} as const;

export const WASI_CASES = [
    { target: 'host32', name: 'actual_host_maximum_counter_save_load_bundle_and_seek' },
    { target: 'host32', name: 'actual_host_empty_change_after_maximum_preserves_header_and_only_empty_query' },
    { target: 'stable_consumer', name: 'stable_maximum_counter_bundle_uses_actual_host_width_without_wrap' },
    {
        target: 'automerge',
        name: 'op_set2::columnar::root_port_weight_tests::root_port_counter_signed_null_zero_max_and_sparse_visits',
    },
    {
        target: 'automerge',
        name: 'op_set2::op_set::op_iter::tests::root_port_counter_inclusive_maximum_merges_id_successor_rows_and_empty_headers',
    },
] as const;

export function requireRustCases(output: string, expected: readonly string[], allowFiltered = false): void {
    if (expected.length === 0 || new Set(expected).size !== expected.length) {
        throw new Error('Expected Rust cases must be nonempty and unique');
    }
    const normalized = output.replaceAll('\r\n', '\n');
    const summaries = [
        ...normalized.matchAll(
            /^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;/gmu
        ),
    ];
    if (summaries.length === 0) throw new Error('Missing real Rust execution summary');
    let passed = 0;
    for (const summary of summaries) {
        const [count, failed, ignored, measured, filtered] = summary.slice(1).map(Number);
        if (
            count === undefined ||
            count === 0 ||
            failed !== 0 ||
            ignored !== 0 ||
            measured !== 0 ||
            (!allowFiltered && filtered !== 0)
        ) {
            throw new Error('Rust admission refuses zero, failed, ignored, measured or unexpected filtered cases');
        }
        passed += count;
    }
    // --nocapture prints the case name before its body, then `ok` on a later line.
    const executions = [...normalized.matchAll(/^test ([\w:]+) \.\.\. /gmu)];
    const observed = executions.map((match) => match[1]);
    for (const [index, execution] of executions.entries()) {
        const next = executions[index + 1]?.index ?? normalized.length;
        const summary = normalized.indexOf('\ntest result:', execution.index);
        const end = summary < 0 ? next : Math.min(next, summary);
        const result = normalized.slice(execution.index, end).trimEnd();
        if (!/(?:\.\.\. |\n)ok$/u.test(result)) throw new Error('A selected Rust case did not report ok');
    }
    if (
        passed !== expected.length ||
        observed.length !== expected.length ||
        new Set(observed).size !== observed.length ||
        expected.some((name) => !observed.includes(name))
    ) {
        throw new Error('Every selected Rust case must actually pass exactly once');
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRustRejections(output: string): void {
    const names = [...output.matchAll(/^expected-rejection: ([\w]+)\r?$/gmu)].map((match) => match[1]);
    if (
        !/^expected-rejections: 6 of 6\r?$/mu.test(output) ||
        names.length !== EXPECTED_REJECTIONS.length ||
        new Set(names).size !== names.length ||
        EXPECTED_REJECTIONS.some((name) => !names.includes(name))
    ) {
        throw new Error('Every selected compiler rejection must report its intended diagnostic');
    }
}

export function wasiExecutables(output: string, targets: readonly string[]): Map<string, string> {
    if (targets.length === 0 || new Set(targets).size !== targets.length)
        throw new Error('WASI targets must be nonempty and unique');
    const found = new Map<string, string>();
    for (const line of output.split(/\r?\n/u)) {
        if (!line.startsWith('{')) continue;
        const item: unknown = JSON.parse(line);
        if (
            !record(item) ||
            item.reason !== 'compiler-artifact' ||
            !record(item.target) ||
            typeof item.target.name !== 'string' ||
            !targets.includes(item.target.name)
        )
            continue;
        if (!record(item.profile) || item.profile.test !== true || typeof item.executable !== 'string') continue;
        if (!isAbsolute(item.executable) || !item.executable.endsWith('.wasm') || found.has(item.target.name)) {
            throw new Error('Ambiguous or non-WASM compiler artifact');
        }
        found.set(item.target.name, item.executable);
    }
    if (found.size !== targets.length) throw new Error('Missing actual WASI test compiler artifact');
    return found;
}

export function requireFixturePlatform(platform: string, actual: string): asserts platform is FixturePlatform {
    const expected = { linux: 'linux', macos: 'darwin', windows: 'win32' };
    if (!Object.hasOwn(expected, platform) || Reflect.get(expected, platform) !== actual) {
        throw new Error('Rust fixture acceptance requires its actual native platform');
    }
}

function execute(program: string, args: readonly string[]): string {
    console.log(`$ ${program} ${args.join(' ')}`);
    const result = spawnSync(program, args, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: {
            ...process.env,
            CARGO_BUILD_JOBS: '2',
            RUST_TEST_THREADS: '2',
            CARGO_NET_OFFLINE: 'false',
            CARGO_TERM_COLOR: 'never',
        },
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    process.stdout.write(output);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${program} failed: ${String(result.status)} ${result.signal ?? ''}`);
    return output;
}

function cargoCases(args: string[], expected: readonly string[], allowFiltered = false): void {
    requireRustCases(
        execute('cargo', ['test', '--locked', ...args, '--', '--test-threads=2']),
        expected,
        allowFiltered
    );
}

function runWasi(): void {
    const common = [
        'test',
        '--locked',
        '--target',
        'wasm32-wasip1',
        '--no-run',
        '--message-format=json-render-diagnostics',
    ];
    const publicBuild = execute('cargo', [
        ...common,
        '--manifest-path',
        'vendor/rust/fixtures/automerge-stable/Cargo.toml',
        '--test',
        'host32',
        '--test',
        'stable_consumer',
    ]);
    const privateBuild = execute('cargo', [
        ...common,
        '--manifest-path',
        'vendor/rust/fixtures/automerge-private/Cargo.toml',
        '--lib',
    ]);
    const binaries = new Map([
        ...wasiExecutables(publicBuild, ['host32', 'stable_consumer']),
        ...wasiExecutables(privateBuild, ['automerge']),
    ]);
    for (const test of WASI_CASES) {
        const binary = binaries.get(test.target);
        if (!binary) throw new Error(`Missing WASI binary: ${test.target}`);
        const output = execute(process.execPath, [
            'vendor/rust/fixtures/automerge-stable/run-wasi.mjs',
            binary,
            test.name,
        ]);
        requireRustCases(output, [test.name], true);
    }
}

export function runRustConsumerFixtures(platform: FixturePlatform, wasi: boolean): void {
    requireFixturePlatform(platform, process.platform);
    if (wasi && platform !== 'linux') throw new Error('WASI acceptance is owned by the selected Linux Rust job');
    if (process.env.WHISPER_DONT_GENERATE_BINDINGS !== undefined)
        throw new Error('Header ABI must generate actual bindings');
    cargoCases(
        [
            '--manifest-path',
            'vendor/rust/fixtures/Cargo.toml',
            '--test',
            'cexpr_nom8',
            '--test',
            'num_enum_syn3',
            '--test',
            'tracing_syn3',
            '--test',
            'visibility_syn3',
        ],
        EXPECTED_RUST_CASES.macros
    );
    const rejection = execute(platform === 'windows' ? 'python' : 'python3', [
        'vendor/rust/fixtures/check-rejections.py',
    ]);
    requireRustRejections(rejection);
    cargoCases(
        ['--manifest-path', 'vendor/rust/fixtures/bindgen-abi/Cargo.toml', '--lib'],
        EXPECTED_RUST_CASES.headers
    );
    if (platform !== 'windows')
        cargoCases(
            ['--manifest-path', 'vendor/rust/fixtures/loader-lifecycle/Cargo.toml', '--lib'],
            EXPECTED_RUST_CASES.loader
        );
    cargoCases(
        ['--manifest-path', 'vendor/rust/fixtures/automerge-stable/Cargo.toml', '--tests'],
        EXPECTED_RUST_CASES.public
    );
    cargoCases(
        ['--manifest-path', 'vendor/rust/fixtures/automerge-private/Cargo.toml', '--lib', 'root_port_'],
        EXPECTED_RUST_CASES.private,
        true
    );
    cargoCases(
        ['--manifest-path', 'vendor/rust/fixtures/automerge-private/Cargo.toml', '--test', 'dev_consumer'],
        EXPECTED_RUST_CASES.dev
    );
    const paired = execute('cargo', [
        'test',
        '--locked',
        '--manifest-path',
        'vendor/rust/fixtures/automerge-private/Cargo.toml',
        '--lib',
        'op_set2::op_set::op_iter::tests',
        '--',
        '--skip',
        'root_port_',
        '--test-threads=2',
    ]);
    requireRustCases(paired, EXPECTED_RUST_CASES.paired, true);
    if (platform === 'windows')
        cargoCases(
            ['--manifest-path', 'vendor/rust/fixtures/Cargo.toml', '--test', 'windows_projection_abi'],
            EXPECTED_RUST_CASES.windows
        );
    if (wasi) runWasi();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [flag, platform, ...options] = process.argv.slice(2);
    if (
        flag !== '--platform' ||
        platform === undefined ||
        options.some((option) => option !== '--wasi') ||
        options.length > 1
    ) {
        throw new Error('Usage: runRustConsumerFixtures --platform <linux|macos|windows> [--wasi]');
    }
    requireFixturePlatform(platform, process.platform);
    runRustConsumerFixtures(platform, options.includes('--wasi'));
}
