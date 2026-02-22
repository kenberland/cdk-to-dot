#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { generateDot } from '../lib/diagram';

const app = new App();
const stack = new NetworkStack(app, 'NetworkStack', {
  env: { account: '123456789012', region: 'us-east-1' },
});

const dot = generateDot(stack);
const outPath = path.resolve(__dirname, '..', 'network.dot');
fs.writeFileSync(outPath, dot);
console.log(`Generated ${outPath}`);
