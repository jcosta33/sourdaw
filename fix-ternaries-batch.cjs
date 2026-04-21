const fs = require('fs');

// proofPresets.ts
let proof = fs.readFileSync('src/modules/Proof/useCases/proofPresets.ts', 'utf8');
proof = proof.replace(
    'i === 1 ? { ...b, gain: 1.5 } : i === 6 ? { ...b, gain: 1.0 } : b',
    '(() => { if (i === 1) return { ...b, gain: 1.5 }; if (i === 6) return { ...b, gain: 1.0 }; return b; })()'
);
proof = proof.replace(
    'i === 1 ? { ...b, gain: 2.0 } : i === 6 ? { ...b, gain: 1.5 } : b',
    '(() => { if (i === 1) return { ...b, gain: 2.0 }; if (i === 6) return { ...b, gain: 1.5 }; return b; })()'
);
proof = proof.replace(
    'i === 1 ? { ...b, gain: 3.0 } : i === 4 ? { ...b, gain: 2.0 } : b',
    '(() => { if (i === 1) return { ...b, gain: 3.0 }; if (i === 4) return { ...b, gain: 2.0 }; return b; })()'
);
proof = proof.replace(
    'i === 1 ? { ...b, gain: 3.5 } : i === 4 ? { ...b, gain: 1.5 } : b',
    '(() => { if (i === 1) return { ...b, gain: 3.5 }; if (i === 4) return { ...b, gain: 1.5 }; return b; })()'
);
fs.writeFileSync('src/modules/Proof/useCases/proofPresets.ts', proof);


// createSynthwaveDemo.ts
let synth = fs.readFileSync('src/modules/Project/useCases/demoProjects/synthwave/createSynthwaveDemo.ts', 'utf8');
synth = synth.replace(
    `][sec.name === 'Fog' ? 0 : sec.name === 'Dust' ? 2 : patIdx]!;`,
    `][(() => { if (sec.name === 'Fog') return 0; if (sec.name === 'Dust') return 2; return patIdx; })()]!;`
);
synth = synth.replace(
    `const accent = param % 1 === 0 ? 70 : param % 0.5 === 0 ? 50 : 30;`,
    `const accent = (() => { if (param % 1 === 0) return 70; if (param % 0.5 === 0) return 50; return 30; })();`
);
synth = synth.replace(
    `const secVel = sec.name === 'Fog' ? 0.5 : sec.name === 'Dust' ? 0.4 : 1;`,
    `const secVel = (() => { if (sec.name === 'Fog') return 0.5; if (sec.name === 'Dust') return 0.4; return 1; })();`
);
fs.writeFileSync('src/modules/Project/useCases/demoProjects/synthwave/createSynthwaveDemo.ts', synth);

// GrinderPanel.tsx
let grinder = fs.readFileSync('src/modules/Grinder/presentations/views/GrinderPanel.tsx', 'utf8');
grinder = grinder.replace(
    `{patch.bright ? 'Bright' : patch.fat ? 'Fat' : 'Classic'}`,
    `{(() => { if (patch.bright) return 'Bright'; if (patch.fat) return 'Fat'; return 'Classic'; })()}`
);
fs.writeFileSync('src/modules/Grinder/presentations/views/GrinderPanel.tsx', grinder);

// KeyboardSplit.tsx
let kb = fs.readFileSync('src/modules/Yeast/presentations/components/KeyboardSplit.tsx', 'utf8');
kb = kb.replace(
    `                            background: sounding\n                                ? 'var(--color-accent-peach)'\n                                : held\n                                  ? 'var(--color-accent-lavender)'\n                                  : '#1a1a1a',`,
    `                            background: (() => {\n                                if (sounding) return 'var(--color-accent-peach)';\n                                if (held) return 'var(--color-accent-lavender)';\n                                return '#1a1a1a';\n                            })(),`
);
kb = kb.replace(
    `                            background: sounding\n                                ? 'var(--color-accent-peach)'\n                                : held\n                                  ? 'var(--color-accent-lavender)'\n                                  : '#0e0e0e',`,
    `                            background: (() => {\n                                if (sounding) return 'var(--color-accent-peach)';\n                                if (held) return 'var(--color-accent-lavender)';\n                                return '#0e0e0e';\n                            })(),`
);
kb = kb.replace(
    `                            opacity: sounding ? 0.9 : held ? 0.7 : 1,`,
    `                            opacity: (() => { if (sounding) return 0.9; if (held) return 0.7; return 1; })(),`
);
fs.writeFileSync('src/modules/Yeast/presentations/components/KeyboardSplit.tsx', kb);

// ChatPanel.tsx
let chat = fs.readFileSync('src/modules/AiRuntime/presentations/views/ChatPanel.tsx', 'utf8');
chat = chat.replace(
    `                                            {msg.isDsoAction ? (\n                                                <Zap className="size-3 text-emerald-400" />\n                                            ) : msg.role === 'assistant' ? (\n                                                <Bot className="size-3 text-[var(--color-accent-lavender)]" />\n                                            ) : (\n                                                <User className="size-3" />\n                                            )}`,
    `                                            {(() => {\n                                                if (msg.isDsoAction) return <Zap className="size-3 text-emerald-400" />;\n                                                if (msg.role === 'assistant') return <Bot className="size-3 text-[var(--color-accent-lavender)]" />;\n                                                return <User className="size-3" />;\n                                            })()}`
);
chat = chat.replace(
    `                                                {msg.isDsoAction\n                                                    ? 'Action'\n                                                    : msg.role === 'assistant'\n                                                      ? 'Assistant'\n                                                      : 'You'}`,
    `                                                {(() => {\n                                                    if (msg.isDsoAction) return 'Action';\n                                                    if (msg.role === 'assistant') return 'Assistant';\n                                                    return 'You';\n                                                })()}`
);
chat = chat.replace(
    `                                                msg.role === 'user'\n                                                    ? 'bg-primary text-primary-foreground rounded-tr-sm'\n                                                    : msg.isDsoAction\n                                                      ? 'bg-emerald-500/10 text-foreground border border-emerald-500/20 rounded-tl-sm w-full'\n                                                      : 'bg-surface-raised text-foreground border border-border/50 rounded-tl-sm w-full',`,
    `                                                (() => {\n                                                    if (msg.role === 'user') return 'bg-primary text-primary-foreground rounded-tr-sm';\n                                                    if (msg.isDsoAction) return 'bg-emerald-500/10 text-foreground border border-emerald-500/20 rounded-tl-sm w-full';\n                                                    return 'bg-surface-raised text-foreground border border-border/50 rounded-tl-sm w-full';\n                                                })(),`
);
fs.writeFileSync('src/modules/AiRuntime/presentations/views/ChatPanel.tsx', chat);

console.log('Replaced ternaries in 5 files.');
