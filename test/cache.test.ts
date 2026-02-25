import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { SubnetGroup } from '../lib/external';
import { CacheNode } from '../lib/cache';
import { generateDot } from '../lib/diagram';

function getMeta(construct: any, key: string): string | undefined {
  const entry = construct.node.metadata.find((e: any) => e.type === key);
  return entry?.data as string | undefined;
}

function makeVpcStack() {
  const app = new App();
  const stack = new Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const vpc = new ec2.Vpc(stack, 'VpcA', {
    ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
    ],
  });
  vpc.node.addMetadata('diagram:label', 'VPC-A');
  vpc.node.addMetadata('diagram:color', 'BLUE');
  return { stack, vpc };
}

describe('CacheNode construct', () => {
  it('creates a CfnCacheCluster with valkey engine', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const cache = new CacheNode(az, 'Redis', {
      vpc,
      label: 'Valkey Cache',
      ip: '10.0.0.100',
      description: 'ElastiCache node',
    });

    expect(cache.cluster).toBeInstanceOf(elasticache.CfnCacheCluster);
    expect(cache.cluster.engine).toBe('valkey');
  });

  it('creates a subnet group and security group', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const cache = new CacheNode(az, 'Redis', {
      vpc,
      label: 'Valkey Cache',
    });

    expect(cache.subnetGroup).toBeInstanceOf(elasticache.CfnSubnetGroup);
    expect(cache.securityGroup).toBeInstanceOf(ec2.SecurityGroup);
  });

  it('attaches diagram metadata', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const cache = new CacheNode(az, 'Redis', {
      vpc,
      label: 'Valkey Cache',
      ip: '10.0.0.100',
      description: 'ElastiCache node',
      cacheNodeType: 'cache.t3.micro',
    });

    expect(getMeta(cache, 'diagram:label')).toBe('Valkey Cache');
    expect(getMeta(cache, 'diagram:ip')).toBe('10.0.0.100');
    expect(getMeta(cache, 'diagram:description')).toBe('ElastiCache node');
    expect(getMeta(cache, 'diagram:engine')).toBe('valkey');
    expect(getMeta(cache, 'diagram:cacheNodeType')).toBe('cache.t3.micro');
    expect(getMeta(cache, 'diagram:numCacheNodes')).toBe('1');
  });

  it('uses custom node type and count', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const cache = new CacheNode(az, 'Redis', {
      vpc,
      label: 'Valkey Cache',
      cacheNodeType: 'cache.r6g.large',
      numCacheNodes: 3,
    });

    expect(cache.cluster.cacheNodeType).toBe('cache.r6g.large');
    expect(cache.cluster.numCacheNodes).toBe(3);
    expect(getMeta(cache, 'diagram:cacheNodeType')).toBe('cache.r6g.large');
    expect(getMeta(cache, 'diagram:numCacheNodes')).toBe('3');
  });
});

describe('CacheNode in generateDot', () => {
  it('renders a CacheNode in the network diagram', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
      ip: '10.0.0.100',
      description: 'ElastiCache node',
    });

    const dot = generateDot(stack);
    expect(dot).toContain('redis_a [');
    expect(dot).toContain('Valkey Cache');
    expect(dot).toContain('10.0.0.100');
    expect(dot).toContain('ElastiCache node');
  });

  it('renders CacheNode inside a subnet group cluster', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet 10.0.0.0/24',
      subtitle: '254 hosts',
    });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
      ip: '10.0.0.100',
    });

    const dot = generateDot(stack);
    const clusterStart = dot.indexOf('subgraph cluster_az_a {');
    const nodePos = dot.indexOf('redis_a [');
    expect(clusterStart).toBeGreaterThan(-1);
    expect(nodePos).toBeGreaterThan(clusterStart);
  });

  it('does not render CacheNode security group as a firewall', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
    });

    const dot = generateDot(stack);
    // The SG inside CacheNode has no diagram:label, so it should not appear
    const firewallCount = (dot.match(/fillcolor="FIREWALL_FILL"/g) || []).length;
    expect(firewallCount).toBe(0);
  });
});
