#!/usr/bin/env -S node --import tsx
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readConfig, snapshot } from './project.ts';
import { evaluate } from './policy.ts';
import { explain } from './retention.ts';
import type { Snapshot } from './model.ts';

const usage = `Usage:
  bonsai check [--root directory] [--base revision] [--policy trusted-file] [--json]
  bonsai explain <file-or-component> [--root directory] [--json]

Exit codes: 0 pass, 1 reject, 2 incomplete or invalid input.
The first adapter supports TypeScript named handlers and literal Gherkin steps.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string', default: '.' }, base: { type: 'string' }, policy: { type: 'string' },
    json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  const [command, query, ...extra] = positionals;
  if (values.help || !command) { console.log(usage); return; }
  if (!['check', 'explain'].includes(command) || extra.length || (command === 'check' && query) || (command === 'explain' && !query)) throw new Error(usage);
  const root = resolve(values.root!);
  let config = readConfig(root, values.policy ? resolve(values.policy) : undefined);
  let base: Snapshot | undefined;
  let temporary: string | undefined;
  try {
    if (values.base) {
      // No base code is executed. Resolve to a SHA before passing it to archive.
      const repository = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
      if (resolve(repository) !== root) throw new Error('--base requires --root to be the Git repository root');
      const sha = execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${values.base}^{commit}`], { encoding: 'utf8' }).trim();
      temporary = mkdtempSync(join(tmpdir(), 'bonsai-base-'));
      const archive = execFileSync('git', ['-C', root, 'archive', sha], { maxBuffer: 64 * 1024 * 1024 });
      execFileSync('tar', ['-x', '-C', temporary], { input: archive });
      // Default to the base's rules and inventory, so candidate policy edits cannot raise its own allowance.
      if (!values.policy) config = readConfig(temporary);
      base = await snapshot(temporary, config, false);
      if (base.contracts.problems.length) throw new Error(`Cannot compile base contracts: ${base.contracts.problems.join('; ')}`);
    }
    const candidate = await snapshot(root, config, command === 'check');
    if (command === 'explain') {
      const components = explain(candidate, query!);
      if (!components.length) throw new Error(`Unknown component or file: ${query}`);
      console.log(JSON.stringify({ fingerprint: candidate.fingerprint, components, problems: candidate.source.problems }, null, 2));
      if (candidate.source.problems.length) process.exitCode = 2;
      return;
    }
    const decision = evaluate(base, candidate, config.policy);
    if (values.json) console.log(JSON.stringify({ decision, snapshot: candidate }, null, 2));
    else {
      console.log(`${decision.status.toUpperCase()}\n\nContract surface: ${base ? `${base.contracts.pairs.length} → ` : ''}${decision.surface} pairs\nRetained size: ${decision.retained} tokens\nCeiling: ${decision.ceiling} tokens\nRequired reduction: ${decision.requiredReduction} tokens\nRequired checks: ${candidate.evidence?.checks.filter(c => c.status === 'passed').length ?? 0} / ${candidate.contracts.checks.length} passed\nUnrooted components: ${candidate.unrooted.length}`);
      if (decision.base) console.log(`Retained change: ${decision.base.retainedChange}\nAdditional capacity: ${decision.base.additionalCapacity}`);
      for (const violation of decision.violations) console.log(`\n- ${violation}`);
    }
    process.exitCode = decision.status === 'pass' ? 0 : decision.status === 'reject' ? 1 : 2;
  } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
}

main().catch(error => {
  console.error(JSON.stringify({ status: 'incomplete', error: String(error) }));
  process.exitCode = 2;
});
