#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { generateDot } from '../lib/diagram';
import { generateRdsDot } from '../lib/rds-diagram';
import { generateEc2Dot } from '../lib/ec2-diagram';
import { generateElastiCacheDot } from '../lib/elasticache-diagram';

const app = new App();
const stack = new NetworkStack(app, 'NetworkStack', {
  env: { account: '123456789012', region: 'us-east-1' },
});

const outDir = path.resolve(__dirname, '..');

const diagrams: { name: string; generate: () => string }[] = [
  { name: 'network', generate: () => generateDot(stack) },
  { name: 'rds', generate: () => generateRdsDot(stack) },
  { name: 'ec2', generate: () => generateEc2Dot(stack) },
  { name: 'elasticache', generate: () => generateElastiCacheDot(stack) },
];

for (const { name, generate } of diagrams) {
  const dot = generate();
  const outPath = path.join(outDir, `${name}.dot`);
  fs.writeFileSync(outPath, dot);
  console.log(`Generated ${outPath}`);
}
