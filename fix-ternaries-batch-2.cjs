const fs = require('fs');

// clipDrawing.ts
let clip = fs.readFileSync('src/modules/Arrangement/presentations/renderers/clipDrawing.ts', 'utf8');
clip = clip.replace(
    'const baseAlpha = isGhost ? 0.35 : isMuted ? 0.35 : 1;',
    'const baseAlpha = (() => { if (isGhost) return 0.35; if (isMuted) return 0.35; return 1; })();'
);
clip = clip.replace(
    'ctx.globalAlpha = isGhost ? 0.6 : isMuted ? 0.35 : 1;',
    'ctx.globalAlpha = (() => { if (isGhost) return 0.6; if (isMuted) return 0.35; return 1; })();'
);
fs.writeFileSync('src/modules/Arrangement/presentations/renderers/clipDrawing.ts', clip);

// PadGrid.tsx
let pad = fs.readFileSync('src/modules/Crumbs/presentations/components/PadGrid.tsx', 'utf8');
pad = pad.replace(
    `                        className={\`relative flex aspect-square flex-col items-center justify-center rounded-xl border transition-all \${
                            isDragTarget
                                ? 'border-white/40 bg-white/[0.1]'
                                : isSelected
                                  ? 'border-white/25 bg-white/[0.06]'
                                  : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
                        }\`}`,
    `                        className={\`relative flex aspect-square flex-col items-center justify-center rounded-xl border transition-all \${(() => {
                            if (isDragTarget) return 'border-white/40 bg-white/[0.1]';
                            if (isSelected) return 'border-white/25 bg-white/[0.06]';
                            return 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]';
                        })()}\`}`
);
pad = pad.replace(
    `                        style={{
                            boxShadow: isFlashing
                                ? \`0 0 20px \${pad.color}88, inset 0 0 12px \${pad.color}44\`
                                : isSelected
                                  ? \`0 0 12px \${pad.color}33\`
                                  : undefined,
                        }}`,
    `                        style={{
                            boxShadow: (() => {
                                if (isFlashing) return \`0 0 20px \${pad.color}88, inset 0 0 12px \${pad.color}44\`;
                                if (isSelected) return \`0 0 12px \${pad.color}33\`;
                                return undefined;
                            })(),
                        }}`
);
fs.writeFileSync('src/modules/Crumbs/presentations/components/PadGrid.tsx', pad);

// CrustGainStrip.tsx
let crust = fs.readFileSync('src/modules/Crust/presentations/components/CrustGainStrip.tsx', 'utf8');
crust = crust.replace(
    `const fillColor = n > 0.66 ? '#C44030' : n > 0.33 ? '#D4A847' : '#5B8FC4';`,
    `const fillColor = (() => { if (n > 0.66) return '#C44030'; if (n > 0.33) return '#D4A847'; return '#5B8FC4'; })();`
);
crust = crust.replace(
    `style={{ color: value > 12 ? '#C44030' : value > 6 ? '#D4A847' : '#E8E6E0' }}`,
    `style={{ color: (() => { if (value > 12) return '#C44030'; if (value > 6) return '#D4A847'; return '#E8E6E0'; })() }}`
);
fs.writeFileSync('src/modules/Crust/presentations/components/CrustGainStrip.tsx', crust);

// GrandBoulePanel.tsx
let boule = fs.readFileSync('src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx', 'utf8');
boule = boule.replace(
    `                            readout={
                                parameters.velocityCurve < 0.95
                                    ? 'soft'
                                    : parameters.velocityCurve > 1.05
                                      ? 'hard'
                                      : 'linear'
                            }`,
    `                            readout={(() => {
                                if (parameters.velocityCurve < 0.95) return 'soft';
                                if (parameters.velocityCurve > 1.05) return 'hard';
                                return 'linear';
                            })()}`
);
boule = boule.replace(
    `readout={lidPosition < 0.3 ? 'closed' : lidPosition < 0.7 ? 'half' : 'full'}`,
    `readout={(() => { if (lidPosition < 0.3) return 'closed'; if (lidPosition < 0.7) return 'half'; return 'full'; })()}`
);
fs.writeFileSync('src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx', boule);

// createNebulaDriftDemo.ts
let drift = fs.readFileSync('src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts', 'utf8');
drift = drift.replace(
    `const dur = state % 5 === 0 ? 6.0 : state % 5 === 3 ? 1.2 : 3.6;`,
    `const dur = (() => { if (state % 5 === 0) return 6.0; if (state % 5 === 3) return 1.2; return 3.6; })();`
);
drift = drift.replace(
    `const baseVel = b >= S.peak && b < S.breakdown ? 85 : b >= S.build1 ? 70 : 55;`,
    `const baseVel = (() => { if (b >= S.peak && b < S.breakdown) return 85; if (b >= S.build1) return 70; return 55; })();`
);
drift = drift.replace(
    `const baseVel = bm >= S.peak && bm < S.breakdown ? 88 : bm >= S.build1 ? 76 : 65;`,
    `const baseVel = (() => { if (bm >= S.peak && bm < S.breakdown) return 88; if (bm >= S.build1) return 76; return 65; })();`
);
drift = drift.replace(
    `const dur = pi % 3 === 0 ? 4.2 : pi % 3 === 1 ? 2.4 : 3.5;`,
    `const dur = (() => { if (pi % 3 === 0) return 4.2; if (pi % 3 === 1) return 2.4; return 3.5; })();`
);
drift = drift.replace(
    `const dur = pi % 4 === 0 ? 3.8 : pi % 4 === 2 ? 1.6 : 2.8;`,
    `const dur = (() => { if (pi % 4 === 0) return 3.8; if (pi % 4 === 2) return 1.6; return 2.8; })();`
);
drift = drift.replace(
    `const dur = bi % 4 === 0 ? 3.2 : bi % 4 === 2 ? 0.8 : 1.6;`,
    `const dur = (() => { if (bi % 4 === 0) return 3.2; if (bi % 4 === 2) return 0.8; return 1.6; })();`
);
fs.writeFileSync('src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts', drift);

console.log('Replaced ternaries in 5 files.');
