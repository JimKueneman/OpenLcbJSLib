// Conformance orchestrator — single entry point that runs every olcbchecker
// check script in every harness mode and prints a pass/fail/skip matrix.
//
// For each mode in MODE_CHECKS:
//   1. Spawn test/harness/run-node.mjs --mode=<mode> --fresh
//   2. Wait for stdout line matching "TCP server listening"
//   3. For each mapped script: spawn python3.10 <script> -a host:port -t <id>
//      -i --auto-reboot, capture stdout, classify by keywords + exit code,
//      push a row to the results table
//   4. SIGINT the harness, wait for exit, move to next mode
//
// Does NOT modify OlcbCheckerClone. Does not rely on control_master.py.
// Keeps running on failure — one FAIL does not abort the matrix.
//
// Usage:
//   node test/harness/run-conformance.mjs [--modes basic,train,...]
//                                         [--port 12021]
//                                         [--node-id 05.01.01.01.07.07]
//                                         [--per-check-timeout 60]
//                                         [--json out.json]
//                                         [--verbose]

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { MODE_CHECKS, ALL_MODES } from './conformance-map.mjs';

// -----------------------------------------------------------------------------
// Argv
// -----------------------------------------------------------------------------

const argv = process.argv.slice(2);
const getArg = (flag, def) => {
    const i = argv.indexOf(flag);
    return i === -1 ? def : argv[i + 1];
};
const hasFlag = (flag) => argv.includes(flag);

const PORT            = parseInt(getArg('--port', '12021'), 10);
const NODE_ID         = getArg('--node-id', '05.01.01.01.07.07');
const PER_CHECK_TO_S  = parseInt(getArg('--per-check-timeout', '60'), 10);
const LIMIT           = parseInt(getArg('--limit', '0'), 10);  // 0 = no limit
const PYTHON_BIN      = getArg('--python', 'python3');

// Per-check timeout overrides (seconds). Default is PER_CHECK_TO_S; add an
// entry here when a specific check legitimately needs longer than the default.
//   check_bt50_freq.py: monitors Report Time events for 130s (+ 5s sync).
const PER_CHECK_TIMEOUT_OVERRIDES = {
    'check_bt50_freq.py': 180,
};
const HARNESS_READY_S = 15;
const JSON_OUT        = getArg('--json', 'test/harness/conformance-results.json');
const VERBOSE         = hasFlag('--verbose') || hasFlag('-v');
const MODES = (getArg('--modes', ALL_MODES.join(',')))
    .split(',').map(s => s.trim()).filter(Boolean);

for (const m of MODES) {
    if (!(m in MODE_CHECKS)) {
        console.error(`Unknown mode '${m}'. Valid: ${ALL_MODES.join(', ')}`);
        process.exit(2);
    }
}

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');               // OpenLcbJSLib
const CHECKER_DIR = resolve(REPO_ROOT, '..', 'OlcbCheckerClone');
const RUN_NODE = join(__dirname, 'run-node.mjs');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(...args) {
    console.log(new Date().toISOString().slice(11, 23), ...args);
}

function classify(stdout, stderr, exitCode, timedOut, timeoutS = PER_CHECK_TO_S) {
    if (timedOut) return { verdict: 'FAIL', reason: `timeout ${timeoutS}s` };
    const combined = stdout + '\n' + stderr;
    const hasFailure = /Failure/i.test(combined);
    const hasSkipped = /Skipped/i.test(combined);
    const hasPassed  = /Passed/i.test(combined);

    // Precedence: Failure > Passed > Skipped > nonzero-exit > UNKNOWN.
    // "Passed wins over exit code" guards against checker cleanup bugs
    // (e.g. NameError in __main__ after check() already returned 0) that
    // would otherwise mask a genuine pass as FAIL.
    if (hasFailure) {
        const m = combined.match(/Failure[^\n]*/);
        return { verdict: 'FAIL', reason: m ? m[0].slice(0, 120) : `exit ${exitCode}` };
    }
    if (hasPassed) {
        const reason = exitCode !== 0 ? `passed despite exit ${exitCode}` : '';
        return { verdict: 'PASS', reason };
    }
    if (hasSkipped) {
        const m = combined.match(/Skipped[^\n]*/);
        return { verdict: 'SKIP', reason: m ? m[0].slice(0, 120) : '' };
    }
    if (exitCode !== 0) return { verdict: 'FAIL', reason: `exit ${exitCode}` };
    return { verdict: 'UNKNOWN', reason: `exit ${exitCode} — no Passed/Skipped/Failure in output` };
}

function spawnHarness(mode) {
    return new Promise((resolveReady, rejectReady) => {
        const proc = spawn(
            process.execPath,
            [RUN_NODE, '--mode', mode, '--port', String(PORT),
             '--node-id', NODE_ID, '--fresh'],
            { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let ready = false;
        let readyTimer = setTimeout(() => {
            if (!ready) {
                rejectReady(new Error(`harness did not print ready line within ${HARNESS_READY_S}s`));
                proc.kill('SIGKILL');
            }
        }, HARNESS_READY_S * 1000);

        proc.stdout.on('data', (buf) => {
            const s = buf.toString();
            if (VERBOSE) process.stdout.write(`  [harness] ${s}`);
            if (!ready && s.includes('harness ready on port')) {
                ready = true;
                clearTimeout(readyTimer);
                resolveReady(proc);
            }
        });
        proc.stderr.on('data', (buf) => {
            if (VERBOSE) process.stderr.write(`  [harness err] ${buf.toString()}`);
        });
        proc.on('exit', (code, sig) => {
            if (!ready) {
                clearTimeout(readyTimer);
                rejectReady(new Error(`harness exited before ready (code=${code}, sig=${sig})`));
            }
        });
    });
}

function stopHarness(proc) {
    return new Promise((res) => {
        if (proc.exitCode !== null) return res();
        proc.once('exit', () => res());
        proc.kill('SIGINT');
        setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 3000);
    });
}

function runCheck(script) {
    return new Promise((res) => {
        const args = [
            script,
            '-a', `localhost:${PORT}`,
            '-t', NODE_ID,
            '-i',                 // skip interactive prompts
            '--auto-reboot',      // use reset datagram, not prompt
        ];
        const proc = spawn(PYTHON_BIN, args, {
            cwd: CHECKER_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '', timedOut = false;
        const timeoutS = PER_CHECK_TIMEOUT_OVERRIDES[script] ?? PER_CHECK_TO_S;
        const killer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGKILL');
        }, timeoutS * 1000);

        proc.stdout.on('data', b => { stdout += b.toString(); });
        proc.stderr.on('data', b => { stderr += b.toString(); });
        proc.on('exit', (code) => {
            clearTimeout(killer);
            res({ stdout, stderr, exitCode: code ?? -1, timedOut });
        });
        proc.on('error', (err) => {
            clearTimeout(killer);
            res({ stdout, stderr: stderr + '\n' + err.message, exitCode: -1, timedOut });
        });
    });
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

const results = {};    // { mode: { script: {verdict, reason, duration_ms} } }
const startedAt = Date.now();

for (const mode of MODES) {
    let scripts = MODE_CHECKS[mode];
    if (LIMIT > 0) scripts = scripts.slice(0, LIMIT);
    results[mode] = {};
    log(`=== mode: ${mode} (${scripts.length} checks) ===`);

    let harness;
    try {
        harness = await spawnHarness(mode);
    } catch (e) {
        log(`  harness startup FAILED: ${e.message}`);
        for (const s of scripts) {
            results[mode][s] = { verdict: 'FAIL', reason: `harness startup: ${e.message}`, duration_ms: 0 };
        }
        continue;
    }

    for (const script of scripts) {
        const t0 = Date.now();
        const { stdout, stderr, exitCode, timedOut } = await runCheck(script);
        const duration_ms = Date.now() - t0;
        const effectiveTimeoutS = PER_CHECK_TIMEOUT_OVERRIDES[script] ?? PER_CHECK_TO_S;
        const { verdict, reason } = classify(stdout, stderr, exitCode, timedOut, effectiveTimeoutS);
        results[mode][script] = { verdict, reason, duration_ms };
        const pad = script.padEnd(44);
        const vpad = verdict.padEnd(7);
        log(`  ${pad} ${vpad} ${duration_ms.toString().padStart(5)}ms  ${reason}`);
        if (VERBOSE && (verdict === 'FAIL' || verdict === 'UNKNOWN')) {
            process.stdout.write(`    ---- stdout ----\n${stdout.split('\n').map(l => '    ' + l).join('\n')}\n`);
            if (stderr.trim()) process.stdout.write(`    ---- stderr ----\n${stderr.split('\n').map(l => '    ' + l).join('\n')}\n`);
        }
    }

    await stopHarness(harness);
}

// -----------------------------------------------------------------------------
// Matrix
// -----------------------------------------------------------------------------

const allScripts = new Set();
for (const mode of MODES) for (const s of Object.keys(results[mode])) allScripts.add(s);
const scriptList = Array.from(allScripts).sort();

const col = (s) => s.padEnd(9);
console.log('');
console.log('='.repeat(80));
console.log('Conformance matrix');
console.log('='.repeat(80));
const header = 'check'.padEnd(44) + MODES.map(m => col(m.slice(0, 8))).join(' ');
console.log(header);
console.log('-'.repeat(header.length));
for (const script of scriptList) {
    const row = script.padEnd(44) + MODES.map(m => {
        const r = results[m][script];
        if (!r) return col('-');
        return col(r.verdict);
    }).join(' ');
    console.log(row);
}
console.log('-'.repeat(header.length));

// Totals per mode
const totals = {};
for (const mode of MODES) {
    const rs = Object.values(results[mode]);
    totals[mode] = {
        pass: rs.filter(r => r.verdict === 'PASS').length,
        skip: rs.filter(r => r.verdict === 'SKIP').length,
        fail: rs.filter(r => r.verdict === 'FAIL').length,
        unknown: rs.filter(r => r.verdict === 'UNKNOWN').length,
        total: rs.length,
    };
}
console.log('totals'.padEnd(44) + MODES.map(m => {
    const t = totals[m];
    return col(`${t.pass}/${t.total}`);
}).join(' '));
console.log('');
for (const m of MODES) {
    const t = totals[m];
    console.log(`  ${m.padEnd(28)} pass=${t.pass} skip=${t.skip} fail=${t.fail} unknown=${t.unknown} (of ${t.total})`);
}

// -----------------------------------------------------------------------------
// JSON output + exit
// -----------------------------------------------------------------------------

const output = {
    meta: {
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        port: PORT,
        nodeId: NODE_ID,
        perCheckTimeoutS: PER_CHECK_TO_S,
    },
    modes: MODES,
    results,
    totals,
};
writeFileSync(resolve(REPO_ROOT, JSON_OUT), JSON.stringify(output, null, 2));
log(`wrote ${JSON_OUT}`);

const anyFail = Object.values(totals).some(t => t.fail > 0 || t.unknown > 0);
process.exit(anyFail ? 1 : 0);
