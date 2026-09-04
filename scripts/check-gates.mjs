/*
 * Every gate in the chains below has to name a script that exists and actually runs.
 *
 * `pnpm <name>` is not the same as `pnpm run <name>`. Where pnpm has a command of its own the
 * command wins, and the script is quietly unreachable: `pnpm deploy` is pnpm's own
 * workspace-deploy, not this repo's deploy script. The sibling auth repo lost a day to the npm
 * version of this, where `pnpm docs` resolved to a builtin that exits 0 without running anything,
 * so a gate reported green for a day while checking nothing.
 */
import { readFileSync } from 'node:fs';

/* pnpm's own commands. One of these is only a problem when a script shares its name, because
   then the command wins and the script is unreachable. */
const PNPM_OWN = new Set([
  'add',
  'audit',
  'bin',
  'config',
  'create',
  'deploy',
  'dlx',
  'env',
  'exec',
  'fetch',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'outdated',
  'pack',
  'patch',
  'publish',
  'rebuild',
  'remove',
  'root',
  'run',
  'server',
  'setup',
  'store',
  'unlink',
  'update',
  'why',
]);

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

const problems = [];

/** Every `pnpm …` call in one command string, as {raw, name, bare}. */
function invocations(command) {
  const out = [];
  for (const m of command.matchAll(/pnpm\s+([^&|;]+)/g)) {
    const words = m[1].trim().split(/\s+/);
    let i = 0;
    // Step over the flags and their values that select where the script runs.
    while (i < words.length) {
      const w = words[i];
      // `--filter` takes its value as the next word; every other flag carries its own.
      if (w === '--filter') i += 2;
      else if (w.startsWith('-')) i += 1;
      else break;
    }
    const first = words[i];
    if (first === undefined) continue;
    out.push({ raw: m[0].trim(), name: first === 'run' ? words[i + 1] : first, bare: first !== 'run' });
  }
  return out;
}

function check(where, command, knownScripts) {
  for (const { raw, name, bare } of invocations(command)) {
    if (name === undefined) continue;
    const shadowed = PNPM_OWN.has(name);
    const isScript = knownScripts.has(name);
    // Only a trap when both exist: `pnpm install` is meant to be pnpm's own, and a script called
    // `deploy` is meant to be the script.
    if (bare && shadowed && isScript) {
      problems.push(
        `${where}: \`${raw}\` runs pnpm's own ${name}, not the script. Use \`pnpm run ${name}\`.`,
      );
    } else if (!isScript && !(bare && shadowed)) {
      problems.push(`${where}: \`${raw}\` names no script`);
    }
  }
}

const rootScripts = new Set(Object.keys(scripts));
for (const chain of ['verify', 'deploy'].filter((c) => scripts[c])) {
  check(`package.json ${chain}`, scripts[chain], rootScripts);
}
for (const m of ci.matchAll(/run:\s*(pnpm[^\n]*)/g)) {
  // The deploy job runs inside packages/api, where a different set of scripts applies.
  const inApi =
    ci.slice(0, m.index).lastIndexOf('working-directory: packages/api') >
    ci.slice(0, m.index).lastIndexOf('- run: pnpm install');
  const known = inApi
    ? new Set(Object.keys(JSON.parse(readFileSync('packages/api/package.json', 'utf8')).scripts ?? {}))
    : rootScripts;
  check('ci.yml', m[1], known);
}

/*
 * And that the two lists are the same list. CI names its steps one per line so a failure says
 * which gate broke; `verify` is the same run locally. Nothing else notices when one grows a step
 * the other never gets, which is how a check ends up only ever running on somebody's laptop.
 */
const checkJob = ci.split(/^  deploy:/m)[0] ?? '';
const inCi = new Set([...checkJob.matchAll(/run:\s*pnpm run ([\w:-]+)/g)].map((m) => m[1]));
const verifyOrder = invocations(scripts.verify ?? '').map((i) => i.name);
const inVerify = new Set(verifyOrder);
for (const name of inCi) {
  if (!inVerify.has(name)) problems.push(`ci.yml runs \`${name}\` and verify does not`);
}
for (const name of inVerify) {
  if (!inCi.has(name)) problems.push(`verify runs \`${name}\` and ci.yml does not`);
}

/*
 * And in the same order, which is what DEPLOY.md promises. Cheap checks first is the point:
 * nobody should wait for the browser suite to learn that a script name was mistyped.
 */
const ciOrder = [...inCi];
if (problems.length === 0 && ciOrder.join(' ') !== verifyOrder.join(' ')) {
  problems.push(
    `verify and ci.yml run the same gates in different orders:\n` +
      `    verify: ${verifyOrder.join(' ')}\n    ci.yml: ${ciOrder.join(' ')}`,
  );
}

if (problems.length > 0) {
  console.error('gate check failed:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

console.log('gates ok: every step of verify, deploy and ci.yml resolves to a real script');
