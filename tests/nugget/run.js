#!/usr/bin/env node
'use strict';

// Run the nugget test suite in eNGE and grade each run the way nugget's
// tests/run-emulator.sh grades PCSX-Redux: on exit code 0 and a positive
// success line, never on the absence of a failure line.
//
//   node tests/nugget/run.js --tests <nugget>/tests --bios <nugget>/openbios/openbios.bin
//
// Options:
//   --tests <dir>          nugget's tests directory, after building it
//                          (see tests/nugget/build.sh); default
//                          tests/nugget/.nugget/tests
//   --bios <file>          BIOS image; default tests/nugget/.nugget/openbios/openbios.bin
//   --jobs <n>             parallel runs; default the number of CPUs
//   --timeout <seconds>    default per-suite wall-clock limit; default 60
//   --renderer <mode>      auto (default), webgl or stub; see headless.js
//   --only <regex>         run only the suites whose name matches
//   --baseline <file>      compare with the expected results in <file>; the
//                          run fails only on a suite that passed there and
//                          fails now. Default tests/nugget/baseline.<renderer>.json
//                          when it exists; --no-baseline fails on any failure.
//   --write-baseline       record this run's results as the baseline
//   --verbose              print the tail of every failing log
//   --log-dir <dir>        keep each suite's full output there

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { SUITES, SKIPS } = require('./suites');

const HERE = __dirname;
const LOCAL = path.join(HERE, '.nugget');

const parseArgs = argv => {
  const options = {
    tests: path.join(LOCAL, 'tests'),
    bios: path.join(LOCAL, 'openbios', 'openbios.bin'),
    jobs: os.availableParallelism ? os.availableParallelism() : os.cpus().length,
    timeout: 60,
    renderer: 'auto',
    only: null,
    baseline: null,
    useBaseline: true,
    writeBaseline: false,
    verbose: false,
    logDir: null,
  };
  for (let i = 0; i < argv.length; ++i) {
    const [name, inline] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], undefined];
    const value = () => inline ?? argv[++i];
    switch (name) {
      case '--tests': options.tests = path.resolve(value()); break;
      case '--bios': options.bios = path.resolve(value()); break;
      case '--jobs': options.jobs = Math.max(1, Number(value()) | 0); break;
      case '--timeout': options.timeout = Number(value()); break;
      case '--renderer': options.renderer = value(); break;
      case '--only': options.only = new RegExp(value()); break;
      case '--baseline': options.baseline = path.resolve(value()); break;
      case '--no-baseline': options.useBaseline = false; break;
      case '--write-baseline': options.writeBaseline = true; break;
      case '--verbose': options.verbose = true; break;
      case '--log-dir': options.logDir = path.resolve(value()); break;
      case '--help': case '-h': {
        const header = fs.readFileSync(__filename, 'utf8').split('\n').slice(3).filter(l => l.startsWith('//'));
        console.log(header.map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
        process.exit(0);
      }
      default:
        console.error(`unknown option ${argv[i]}; see --help`);
        process.exit(2);
    }
  }
  return options;
};

const options = parseArgs(process.argv.slice(2));

// The webgl renderer needs a display. One X server for the whole run, as in
// run-emulator.sh: parallel `xvfb-run -a` instances race for display numbers.
const wantsGl = () => {
  if (options.renderer === 'stub') return false;
  try { require.resolve('gl'); return true; } catch { return false; }
};
if (wantsGl() && !process.env.DISPLAY && !process.env.ENGE_UNDER_XVFB && process.platform === 'linux') {
  const probe = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
  if (probe.status === 0) {
    const result = spawnSync('xvfb-run', ['-a', process.execPath, __filename, ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, ENGE_UNDER_XVFB: '1' },
    });
    process.exit(result.status ?? 1);
  }
}

// The renderer every run uses, settled once so all runs and the baseline agree.
const effectiveRenderer = () => {
  if (options.renderer === 'stub' || !wantsGl()) return 'stub';
  return process.env.DISPLAY || process.platform !== 'linux' ? 'webgl' : 'stub';
};
const renderer = effectiveRenderer();
if (options.renderer === 'webgl' && renderer !== 'webgl') {
  console.error('the webgl renderer needs the `gl` package and a display; see tests/nugget/README.md');
  process.exit(2);
}
options.baseline ??= path.join(HERE, `baseline.${renderer}.json`);

const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return entry.name.endsWith('.ps-exe') ? [full] : [];
});

const runSuite = suite => new Promise(resolve => {
  const exe = path.join(options.tests, `${suite.exe}.ps-exe`);
  const timeout = suite.timeout ?? options.timeout;
  const started = Date.now();
  const child = spawn(process.execPath, [
    path.join(HERE, 'headless.js'), '--bios', options.bios, '--timeout', String(timeout),
    '--renderer', renderer, exe,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => chunks.push(chunk));
  // headless.js enforces the limit itself; this only catches a wedged process.
  let hung = false;
  const killer = setTimeout(() => { hung = true; child.kill('SIGKILL'); }, (timeout + 15) * 1000);

  child.on('close', (code, signal) => {
    clearTimeout(killer);
    const log = stripAnsi(Buffer.concat(chunks).toString('latin1'));
    const pattern = new RegExp(suite.success, 'm');
    const line = log.split('\n').filter(l => pattern.test(l)).pop();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const passed = code === 0 && !!line;
    if (options.logDir) fs.writeFileSync(path.join(options.logDir, `${suite.name}.log`), log);
    resolve({ suite, passed, code: hung ? 'hang' : (code ?? signal), line, log, seconds });
  });
});

const pool = async (items, limit, worker) => {
  const results = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
};

const tail = (log, lines = 40) => log.trimEnd().split('\n').slice(-lines).map(l => `    ${l}`).join('\n');

const main = async () => {
  if (!fs.existsSync(options.tests)) {
    console.error(`no nugget tests at ${options.tests}; build them with tests/nugget/build.sh or pass --tests`);
    process.exit(2);
  }
  if (!fs.existsSync(options.bios)) {
    console.error(`no BIOS at ${options.bios}; pass --bios`);
    process.exit(2);
  }
  if (options.logDir) fs.mkdirSync(options.logDir, { recursive: true });

  let fail = false;

  // Every built ps-exe has to be either run or skipped, and every listed one built.
  const known = new Set([...SUITES.map(s => s.exe), ...SKIPS.keys()]);
  const built = new Set(walk(options.tests).map(f => path.relative(options.tests, f).split(path.sep).join('/').replace(/\.ps-exe$/, '')));
  for (const exe of [...built].sort()) {
    if (!known.has(exe)) { console.log(`UNLISTED: tests/${exe}.ps-exe is neither run nor skipped in tests/nugget/suites.js`); fail = true; }
  }
  for (const exe of [...known].sort()) {
    if (!built.has(exe)) { console.log(`MISSING: tests/${exe}.ps-exe was not built`); fail = true; }
  }

  console.log(`renderer: ${renderer}${renderer === 'stub' ? ' (draws are dropped; install `gl` for the WebGL renderer)' : ''}`);
  const selected = SUITES.filter(s => (!options.only || options.only.test(s.name)) && built.has(s.exe));

  const results = await pool(selected, options.jobs, async suite => {
    const result = await runSuite(suite);
    const needs = suite.needs ? ` [needs ${suite.needs}]` : '';
    if (result.passed) {
      console.log(`PASS ${suite.name} (${result.seconds}s): ${result.line}`);
    } else {
      const why = result.code === 124 ? 'timeout'
        : result.code === 'hang' ? 'hung inside the emulator, killed'
          : result.code === 70 ? 'emulator stopped' : `exit ${result.code}`;
      const summary = `FAIL ${suite.name} (${result.seconds}s): ${why}, no success line${needs}`;
      console.log(options.verbose ? `${summary}\n${tail(result.log)}` : summary);
    }
    return result;
  });

  const passed = results.filter(r => r.passed);
  console.log();
  console.log(`=== SKIPPED (${SKIPS.size}) ===`);
  for (const [exe, reason] of SKIPS) console.log(`  tests/${exe}.ps-exe: ${reason}`);
  console.log();
  console.log(`=== ${passed.length}/${results.length} suites passed, ${SKIPS.size} skipped, ${built.size} built ===`);

  const current = Object.fromEntries(results.map(r => [r.suite.name, r.passed ? 'pass' : 'fail']));

  if (options.writeBaseline) {
    const previous = fs.existsSync(options.baseline) ? JSON.parse(fs.readFileSync(options.baseline, 'utf8')) : {};
    const merged = Object.fromEntries(Object.entries({ ...previous, ...current }).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(options.baseline, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`baseline written to ${path.relative(process.cwd(), options.baseline)}`);
  } else if (options.useBaseline && fs.existsSync(options.baseline)) {
    const baseline = JSON.parse(fs.readFileSync(options.baseline, 'utf8'));
    const regressions = results.filter(r => !r.passed && baseline[r.suite.name] === 'pass');
    const fixed = results.filter(r => r.passed && baseline[r.suite.name] !== 'pass');
    if (fixed.length) console.log(`newly passing (update the baseline with --write-baseline): ${fixed.map(r => r.suite.name).join(', ')}`);
    if (regressions.length) {
      console.log(`REGRESSIONS against ${path.basename(options.baseline)}: ${regressions.map(r => r.suite.name).join(', ')}`);
      fail = true;
    } else {
      console.log(`no regressions against ${path.basename(options.baseline)}`);
    }
  } else if (passed.length !== results.length) {
    fail = true;
  }

  process.exit(fail ? 1 : 0);
};

main();
