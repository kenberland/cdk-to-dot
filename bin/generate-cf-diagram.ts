#!/usr/bin/env ts-node
/**
 * generate-cf-diagram.ts
 *
 * Reads a cdk.out directory (tree.json + *.template.json) and generates
 * a Graphviz DOT diagram of the deployed architecture.
 *
 * Usage:
 *   npm run diagram:cf                        # default: ../cdk.out
 *   npm run diagram:cf -- --input /path/to/cdk.out
 *   npm run diagram:cf -- --output cmdr.dot
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateCfDot } from '../lib/cf-diagram';

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = path.resolve(__dirname, '..', '..', 'cdk.out');
  let output = path.resolve(__dirname, '..', 'cmdr.dot');

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--input' || args[i] === '-i') && args[i + 1]) {
      input = path.resolve(args[++i]);
    } else if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
      output = path.resolve(args[++i]);
    }
  }

  return { input, output };
}

const { input, output } = parseArgs();

if (!fs.existsSync(path.join(input, 'tree.json'))) {
  console.error(`Error: no tree.json found in ${input}`);
  console.error('Run "cdk synth" in the CDK project first.');
  process.exit(1);
}

console.log(`Reading cdk.out from: ${input}`);
const dot = generateCfDot(input);
fs.writeFileSync(output, dot);
console.log(`Generated: ${output}`);
