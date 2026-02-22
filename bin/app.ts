#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';

const app = new App();
new NetworkStack(app, 'NetworkStack', {
  env: { account: '123456789012', region: 'us-east-1' },
});
