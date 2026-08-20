#!/usr/bin/env node
/**
 * download-levain-samples-direct.mjs
 *
 * Downloads VSCO-2-CE samples directly from raw.githubusercontent.com
 * WITHOUT using the GitHub API (no rate limiting).
 *
 * Source: https://github.com/sgossner/VSCO-2-CE
 * License: CC0 (public domain — no attribution required)
 *
 * Usage:
 *   node scripts/download-levain-samples-direct.ts --print-asset-policy
 *   SOURDAW_ALLOW_PUBLIC_SAMPLE_DOWNLOAD=1 node scripts/download-levain-samples-direct.ts
 */

import { existsSync } from 'node:fs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const VSCO_REVISION = '440300901dfe9275fd84e0b7763af1f8443ae62e';
const RAW_BASE = `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO_REVISION}`;
const OUT_DIR = 'public/samples/levain';
const PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV = 'SOURDAW_ALLOW_PUBLIC_SAMPLE_DOWNLOAD';
const PRINT_ASSET_POLICY_FLAG = '--print-asset-policy';
const PUBLIC_SAMPLE_ASSET_POLICY = [
    'Sourdaw public sample asset policy:',
    '- public/samples/levain is a large generated CC0 sample payload.',
    '- Do not add, refresh, or expand this payload accidentally from an agent or CI run.',
    '- Existing tracked files are not deleted or moved without explicit human instruction naming files.',
    `- Set ${PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV}=1 only for an intentional sample-payload refresh.`,
].join('\n');

function shouldContinueWithPublicSampleDownload(): boolean {
    if (process.argv.includes(PRINT_ASSET_POLICY_FLAG)) {
        console.log(PUBLIC_SAMPLE_ASSET_POLICY);
        return false;
    }

    if (process.env[PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV] === '1') {
        return true;
    }

    console.error(PUBLIC_SAMPLE_ASSET_POLICY);
    console.error(`\nRefusing to write ${OUT_DIR}; set ${PUBLIC_SAMPLE_DOWNLOAD_OPT_IN_ENV}=1 to continue.`);
    process.exitCode = 1;
    return false;
}

// ─── Note name → MIDI ────────────────────────────────────────────────────

const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteNameToMidi(name) {
    const m = name.match(/^([A-G])(b|#?)(\d+)$/);
    if (!m) return null;
    const [, letter, accidental, octStr] = m;
    const semitone = NOTE_NAMES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    return (parseInt(octStr, 10) + 1) * 12 + semitone;
}

// ─── Parse filename → { midi, dynamic, rrPos } ───────────────────────────

function parseFilename(filename) {
    // Map Timpani arbitrary index to common timpani tuning and strip "Hit"
    if (filename.includes('Timpani1_Hit_')) filename = filename.replace('Timpani1_Hit_', 'timpani_C2_');
    if (filename.includes('Timpani2_Hit_')) filename = filename.replace('Timpani2_Hit_', 'timpani_G2_');
    if (filename.includes('Timpani3_Hit_')) filename = filename.replace('Timpani3_Hit_', 'timpani_C3_');
    if (filename.includes('Timpani4_Hit_')) filename = filename.replace('Timpani4_Hit_', 'timpani_F3_');
    if (filename.includes('Timpani5_Hit_')) filename = filename.replace('Timpani5_Hit_', 'timpani_C4_');

    const base = filename.replace('.wav', '');
    const parts = base.split('_');

    // Strip out generic descriptive parts like "Mid", "Close", "sus", "stac" that might be at the end.
    // Keep popping until we hit a note, a dynamic, or rr/numeric identifier.
    while (parts.length > 0) {
        const p = parts[parts.length - 1];
        if (!p) break;
        if (p.match(/^(v\d+|loud|soft|medium|p+?|f+?|m[pf]|rr\d+|\d+|[A-G][b#]?\d+)$/i)) break;
        parts.pop();
    }

    let rrPos = 0;
    const last = parts[parts.length - 1];
    if (last?.match(/^rr(\d+)$/i)) {
        rrPos = parseInt(last.replace(/^rr/i, ''), 10) - 1;
        parts.pop();
    } else if (last?.match(/^\d+$/)) {
        // Handle files like "ViolaEns_susvib_A3_v1_1.wav"
        rrPos = parseInt(last, 10) - 1;
        parts.pop();
    }

    const velPart = parts[parts.length - 1];
    let dynamic;
    if (velPart?.match(/^(v\d+|loud|soft|medium)$/i)) {
        dynamic = velPart.toLowerCase(); // v1, v2, v3...
        parts.pop();
    } else if (['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'].includes(velPart)) {
        dynamic = velPart;
        parts.pop();
    } else {
        dynamic = 'v1';
    }

    const notePart = parts[parts.length - 1];
    if (!notePart) return null;
    const midi = noteNameToMidi(notePart);
    if (midi === null) return null;

    return { midi, dynamic, rrPos };
}

// ─── Download one file ───────────────────────────────────────────────────

async function download(remotePath, localPath) {
    if (existsSync(localPath)) return 'cached';
    const encoded = remotePath.split('/').map(encodeURIComponent).join('/');
    const url = `${RAW_BASE}/${encoded}`;
    const res = await fetch(url);
    if (!res.ok) {
        // Try with raw URL from download_url format
        throw new Error(`${res.status} ${url}`);
    }
    await writeFile(localPath, Buffer.from(await res.arrayBuffer()));
    return 'downloaded';
}

// ─── Key range builder ──────────────────────────────────────────────────

function buildKeyRanges(sortedMidis, [rangeMin, rangeMax]) {
    return sortedMidis.map((midi, i) => {
        const prev = sortedMidis[i - 1];
        const next = sortedMidis[i + 1];
        return {
            midi,
            loKey: prev !== undefined ? Math.round((prev + midi) / 2) + 1 : rangeMin,
            hiKey: next !== undefined ? Math.round((midi + next) / 2) : rangeMax,
        };
    });
}

// ─── Velocity layer builder ─────────────────────────────────────────────

const DYN_ORDER = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];

function velLayers(dynamics) {
    const sorted = [...new Set(dynamics)].sort((a, b) => DYN_ORDER.indexOf(a) - DYN_ORDER.indexOf(b));
    const n = sorted.length;
    return sorted.map((d, i) => ({
        dynamic: d,
        loVel: Math.round((i / n) * 127),
        hiVel: i < n - 1 ? Math.round(((i + 1) / n) * 127) - 1 : 127,
    }));
}

// ─── Process one articulation from a hardcoded file list ────────────────

async function processArt({ files, vscoPath, artType, artId, loopMode, keyRange, outDir }) {
    const parsed = [];
    for (const filename of files) {
        const info = parseFilename(filename);
        if (info) parsed.push({ ...info, filename });
    }

    if (parsed.length === 0) {
        console.warn(`    ⚠️  No parseable files in ${artType}`);
        return null;
    }

    // Group by midi note
    const byNote = new Map();
    for (const p of parsed) {
        if (!byNote.has(p.midi)) byNote.set(p.midi, []);
        byNote.get(p.midi).push(p);
    }

    const allDynamics = parsed.map((p) => p.dynamic);
    const layers = velLayers(allDynamics);
    const sortedMidis = [...byNote.keys()].sort((a, b) => a - b);
    const ranges = buildKeyRanges(sortedMidis, keyRange);

    const zones = [];
    let dl = 0,
        cached = 0,
        errors = 0;

    for (const { midi, loKey, hiKey } of ranges) {
        const noteSamples = byNote.get(midi) || [];
        for (const layer of layers) {
            const rrSamples = noteSamples.filter((s) => s.dynamic === layer.dynamic).sort((a, b) => a.rrPos - b.rrPos);
            if (rrSamples.length === 0) continue;

            const rrLen = rrSamples.length;
            for (const sample of rrSamples) {
                const localPath = join(outDir, sample.filename);
                try {
                    const result = await download(`${vscoPath}/${sample.filename}`, localPath);
                    if (result === 'downloaded') dl++;
                    else cached++;
                } catch (err) {
                    console.warn(`      ✗ ${sample.filename}: ${err.message}`);
                    errors++;
                    continue;
                }
                zones.push({
                    file: sample.filename,
                    rootNote: midi,
                    loKey,
                    hiKey,
                    loVel: layer.loVel,
                    hiVel: layer.hiVel,
                    rrPos: sample.rrPos,
                    rrLen,
                    micId: 0,
                    isRelease: false,
                    loopMode,
                    loopStart: 0,
                    loopEnd: 0,
                    loopCrossfade: 0,
                    gainDb: 0,
                    attack: ['sustain', 'tremolo'].includes(artType) ? 0.02 : 0.005,
                    decay: 0.1,
                    sustain: 1.0,
                    release: ['sustain', 'tremolo'].includes(artType) ? 0.5 : 0.15,
                });
            }
        }
    }

    console.log(
        `    ✓ ${zones.length} zones — ${dl} downloaded, ${cached} cached${errors > 0 ? `, ${errors} errors` : ''}`
    );
    if (zones.length === 0) return null;
    return { type: artType, id: artId, zones };
}

// ─── Fetch file list via SFZ-free approach: built from common patterns ──

async function fetchFileList(vscoPath) {
    // SFZ-free approach: scrape the directory listing HTML from github directly.
    // This avoids the restrictive 60 req/hr API limit from api.github.com.
    const url = `https://github.com/sgossner/VSCO-2-CE/tree/${VSCO_REVISION}/${vscoPath.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 429) return null; // Extreme HTTP rate limiting
        console.warn(`    ⚠️  Failed to fetch HTML tree: ${res.status}`);
        return null;
    }
    const html = await res.text();
    const regex = new RegExp('/sgossner/VSCO-2-CE/blob/' + VSCO_REVISION + '/([^"]+\\.wav)', 'gi');
    const matches = [...html.matchAll(regex)];
    const uniqueFiles = new Set();
    for (const match of matches) {
        const fullPath = decodeURIComponent(match[1]);
        uniqueFiles.add(fullPath.split('/').pop());
    }
    return [...uniqueFiles];
}

// ─── Instrument definitions with all expected articulations ─────────────

const INSTRUMENTS = [
    {
        id: 'violin-1',
        keyRange: [55, 103],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Strings/Solo Violin/Arco Vib' },
            { artType: 'spiccato', artId: 7, loopMode: 'none', vscoPath: 'Strings/Solo Violin/spic' },
            { artType: 'pizzicato', artId: 10, loopMode: 'none', vscoPath: 'Strings/Solo Violin/Pizz' },
            { artType: 'tremolo', artId: 13, loopMode: 'forward', vscoPath: 'Strings/Solo Violin/Trem' },
        ],
    },
    {
        id: 'violin-2',
        keyRange: [55, 103],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Strings/Violin Section/susVib' },
            { artType: 'spiccato', artId: 7, loopMode: 'none', vscoPath: 'Strings/Violin Section/Spic' },
            { artType: 'pizzicato', artId: 10, loopMode: 'none', vscoPath: 'Strings/Violin Section/Pizz' },
            { artType: 'tremolo', artId: 13, loopMode: 'forward', vscoPath: 'Strings/Violin Section/Trem' },
        ],
    },
    {
        id: 'viola',
        keyRange: [48, 93],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Strings/Viola Section/susvib' },
            { artType: 'spiccato', artId: 7, loopMode: 'none', vscoPath: 'Strings/Viola Section/spic' },
            { artType: 'pizzicato', artId: 10, loopMode: 'none', vscoPath: 'Strings/Viola Section/pizz' },
        ],
    },
    {
        id: 'cello',
        keyRange: [36, 84],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Strings/Cello Section/susvib' },
            { artType: 'spiccato', artId: 7, loopMode: 'none', vscoPath: 'Strings/Cello Section/spic' },
            { artType: 'pizzicato', artId: 10, loopMode: 'none', vscoPath: 'Strings/Cello Section/pizzT' },
        ],
    },
    {
        id: 'double-bass',
        keyRange: [28, 67],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Strings/Solo Contrabass/SusVib' },
            { artType: 'pizzicato', artId: 10, loopMode: 'none', vscoPath: 'Strings/Solo Contrabass/Pizz' },
            { artType: 'spiccato', artId: 7, loopMode: 'none', vscoPath: 'Strings/Solo Contrabass/Spic' },
        ],
    },
    {
        id: 'trumpet',
        keyRange: [54, 82],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Brass/Trumpet/susvib' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Brass/Trumpet/stac' },
        ],
    },
    {
        id: 'horn',
        keyRange: [34, 77],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Brass/F Horn/sus' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Brass/F Horn/stac' },
        ],
    },
    {
        id: 'trombone',
        keyRange: [40, 72],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Brass/Tenor Trombone/sus' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Brass/Tenor Trombone/stac' },
        ],
    },
    {
        id: 'tuba',
        keyRange: [28, 60],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Brass/Tuba/sus' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Brass/Tuba/stac' },
        ],
    },
    {
        id: 'flute',
        keyRange: [60, 96],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Woodwinds/Flute/susvib' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Woodwinds/Flute/stac' },
        ],
    },
    {
        id: 'oboe',
        keyRange: [58, 91],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Woodwinds/Oboe/Sus' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Woodwinds/Oboe/Stacc' },
        ],
    },
    {
        id: 'clarinet',
        keyRange: [50, 91],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Woodwinds/Clarinet/susLong' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Woodwinds/Clarinet/stac' },
        ],
    },
    {
        id: 'bassoon',
        keyRange: [34, 75],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Woodwinds/Bassoon/sus' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Woodwinds/Bassoon/stac' },
        ],
    },
    {
        id: 'piccolo',
        keyRange: [74, 108],
        articulations: [
            { artType: 'sustain', artId: 0, loopMode: 'forward', vscoPath: 'Woodwinds/Piccolo/Sus' },
            { artType: 'staccato', artId: 8, loopMode: 'none', vscoPath: 'Woodwinds/Piccolo/Stac' },
        ],
    },
    {
        id: 'glockenspiel',
        keyRange: [72, 108],
        articulations: [{ artType: 'sustain', artId: 0, loopMode: 'none', vscoPath: 'Percussion/Glock' }],
    },
    {
        id: 'marimba',
        keyRange: [45, 96],
        articulations: [{ artType: 'sustain', artId: 0, loopMode: 'none', vscoPath: 'Percussion/Marimba' }],
    },
    {
        id: 'timpani',
        keyRange: [36, 57],
        articulations: [{ artType: 'sustain', artId: 0, loopMode: 'none', vscoPath: 'Percussion/Timpani' }],
    },
];

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
    if (!shouldContinueWithPublicSampleDownload()) {
        return;
    }

    console.log('🎻 Levain Sample Downloader (direct — no API rate limit)\n');
    let skippedDueToRateLimit = false;

    for (const { id, keyRange, articulations } of INSTRUMENTS) {
        const outDir = join(OUT_DIR, id);
        await mkdir(outDir, { recursive: true });

        // Check if manifest already complete
        const manifestPath = join(outDir, 'manifest.json');
        let existingArts = [];
        if (existsSync(manifestPath)) {
            try {
                const m = JSON.parse(await readFile(manifestPath, 'utf8'));
                existingArts = m.articulations?.map((a) => a.type) ?? [];
            } catch {
                /* ignore */
            }
        }

        const pending = articulations.filter((a) => !existingArts.includes(a.artType));
        if (pending.length === 0) {
            console.log(`✓ ${id} — already complete, skipping`);
            continue;
        }

        console.log(`\n📂 ${id} (${pending.length} articulations to fetch)`);

        const resultArts =
            existingArts.length > 0 ? JSON.parse(await readFile(manifestPath, 'utf8')).articulations : [];

        for (const art of pending) {
            console.log(`  🎵 ${art.artType} (${art.vscoPath})`);

            // Fetch file list via GitHub API (gracefully skips on rate limit)
            const files = await fetchFileList(art.vscoPath);
            if (!files) {
                console.warn(`    ⚠️  Rate limited, skipping`);
                skippedDueToRateLimit = true;
                continue;
            }
            if (files.length === 0) {
                console.warn(`    ⚠️  No WAV files found`);
                continue;
            }

            const result = await processArt({
                files,
                outDir,
                vscoPath: art.vscoPath,
                artType: art.artType,
                artId: art.artId,
                loopMode: art.loopMode,
                keyRange,
            });

            if (result) resultArts.push(result);
        }

        if (resultArts.length > 0) {
            const manifest = {
                version: 1,
                instrumentId: id,
                sampleRate: 44100,
                micPositions: ['close'],
                articulations: resultArts,
            };
            await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
            console.log(`  📋 manifest.json written (${resultArts.length} articulations)`);
        }
    }

    if (skippedDueToRateLimit) {
        console.log('\n⏳ Some instruments were skipped due to GitHub rate limiting.');
        console.log('   Re-run this script after the rate limit resets to complete the download.');
    } else {
        console.log('\n✅ All instruments complete!');
    }
}

main().catch((err) => {
    console.error('❌', err);
    process.exit(1);
});
