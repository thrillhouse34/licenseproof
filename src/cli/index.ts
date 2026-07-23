#!/usr/bin/env node
import { Command } from 'commander';
import { runScan } from './scan';
import { runReport } from './report';
import { runActivate } from './activate';
import { runDeactivate } from './deactivate';
import { getToolVersion } from '../toolVersion';

/**
 * Collector for `--format`: supports BOTH a comma-separated list
 * (`--format html,pdf`) AND repeated flags (`--format html --format pdf`).
 * Commander calls this once per `--format` occurrence, accumulating into
 * `previous`; each occurrence's value is additionally split on commas. Unknown
 * values are validated (and rejected) downstream in runReport, not here.
 */
function collectFormats(value: string, previous: string[]): string[] {
  return previous.concat(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

const program = new Command();

program
  .name('licenseproof')
  .description("Know every license in your dependency tree — before your customer's lawyer asks.")
  .version(getToolVersion());

program
  .command('scan')
  .argument('[path]', 'project path to scan', '.')
  .option('--production-only', 'skip devDependencies (default: true)', true)
  .option('--include-dev', 'include devDependencies (inverse of --production-only)')
  .option('--format <format>', 'output format: summary or json', 'summary')
  .option('--project-license <id>', 'declared license of your own project (SPDX id or expression); overrides package.json')
  .option('--fail-on <mode>', 'exit code 1 trigger: conflict, review, or never', 'conflict')
  .option('--no-color', 'disable ANSI color output')
  .action(async (pathArg: string, options: any) => {
    const failOn = ['conflict', 'review', 'never'].includes(options.failOn) ? options.failOn : 'conflict';
    const result = await runScan({
      path: pathArg,
      productionOnly: options.includeDev ? false : true,
      format: options.format === 'json' ? 'json' : 'summary',
      failOn,
      projectLicenseOverride: options.projectLicense,
      colorEnabled: options.color === false ? false : undefined,
    });
    console.log(result.output);
    process.exit(result.exitCode);
  });

program
  .command('report')
  .argument('[path]', 'project path to scan', '.')
  .description('generate paid report artifacts (HTML, PDF, notices, SBOM) from a scan')
  .option(
    '--format <formats>',
    'artifact format(s): html, pdf, notices, sbom-cyclonedx, sbom-spdx. Comma-separated (--format html,pdf) or repeatable (--format html --format pdf). html, pdf, notices, and sbom-spdx require a license key; sbom-cyclonedx is free.',
    collectFormats,
    [],
  )
  .option(
    '--out <path>',
    'output location. With exactly one --format, a literal file path. With multiple formats (or omitted), a directory holding per-format default filenames (report.html, report.pdf, THIRD_PARTY_NOTICES.txt, sbom.cyclonedx.json, sbom.spdx.json). Omitted entirely: ./licenseproof-report/',
  )
  .option('--key <key>', 'license key (overrides LICENSEPROOF_KEY and the activated key file for this run)')
  .option('--production-only', 'skip devDependencies (default: true)', true)
  .option('--include-dev', 'include devDependencies (inverse of --production-only)')
  .option('--project-license <id>', 'declared license of your own project (SPDX id or expression); overrides package.json')
  .addHelpText(
    'after',
    '\nGating: html, pdf, notices, and sbom-spdx require a valid license key\n' +
      '(resolved in order from --key, then $LICENSEPROOF_KEY, then\n' +
      '~/.config/licenseproof/license.key). If any requested format is gated and no\n' +
      'valid key is found, the WHOLE request is refused (nothing is written) with\n' +
      'exit code 3. sbom-cyclonedx alone needs no key. Activate a key once with\n' +
      '`licenseproof activate <key>`.\n\n' +
      'Exit codes: 0 success · 2 usage/tool error · 3 a gated format was requested\n' +
      'without a valid license key.',
  )
  .action(async (pathArg: string, options: any) => {
    const result = await runReport({
      path: pathArg,
      productionOnly: options.includeDev ? false : true,
      formats: options.format,
      out: options.out,
      key: options.key,
      projectLicenseOverride: options.projectLicense,
    });
    console.log(result.output);
    process.exit(result.exitCode);
  });

program
  .command('activate')
  .argument('<key>', 'the license key from your purchase email')
  .description('verify and store a license key so the report command unlocks its paid formats')
  .action((key: string) => {
    const result = runActivate(key);
    console.log(result.output);
    process.exit(result.exitCode);
  });

program
  .command('deactivate')
  .description('remove the stored license key (~/.config/licenseproof/license.key); idempotent')
  .action(() => {
    const result = runDeactivate();
    console.log(result.output);
    process.exit(result.exitCode);
  });

program.parse(process.argv);
