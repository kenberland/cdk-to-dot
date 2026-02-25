import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SubnetGroup, addConnections } from '../lib/external';
import { ServerFleet } from '../lib/compute';
import { CacheNode } from '../lib/cache';
import { generateElastiCacheDot } from '../lib/elasticache-diagram';

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

describe('generateElastiCacheDot', () => {
  it('produces a valid digraph', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
      ip: '10.0.0.100',
    });

    const dot = generateElastiCacheDot(stack);
    expect(dot).toMatch(/^digraph ElastiCacheArchitecture \{/);
    expect(dot.trimEnd()).toMatch(/\}$/);
  });

  it('includes ElastiCache title', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new CacheNode(az, 'RedisA', { vpc, label: 'Valkey Cache' });

    const dot = generateElastiCacheDot(stack);
    expect(dot).toContain('ElastiCache Architecture');
  });

  it('renders cache node with engine and node type details', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
      ip: '10.0.0.100',
      description: 'ElastiCache node',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 2,
    });

    const dot = generateElastiCacheDot(stack);
    expect(dot).toContain('redis_a [');
    expect(dot).toContain('Valkey Cache');
    expect(dot).toContain('10.0.0.100');
    expect(dot).toContain('valkey');
    expect(dot).toContain('cache.t3.micro');
    expect(dot).toContain('Node Type');
    expect(dot).toContain('>2<');
  });

  it('shows VPC and subnet placement', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'Subnet 10.0.0.0/24', subtitle: 'hosts' });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
    });

    const dot = generateElastiCacheDot(stack);
    expect(dot).toContain('VPC-A');
    expect(dot).toContain('Subnet 10.0.0.0/24');
  });

  it('renders edges from app servers to cache', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const appServers = new ServerFleet({
      vpc,
      scope: az,
      id: 'AppServers',
      count: 2,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'App Servers',
      ip: '10.0.0.20–21',
      description: 'Java',
      connections: [
        { target: 'RedisA', label: 'cache r/w', color: 'EDGE' },
      ],
    });

    new CacheNode(az, 'RedisA', {
      vpc,
      label: 'Valkey Cache',
    });

    const dot = generateElastiCacheDot(stack);
    expect(dot).toContain('app_servers -> redis_a [');
    expect(dot).toContain('cache r/w');
  });

  it('produces empty diagram when no cache nodes exist', () => {
    const { stack } = makeVpcStack();
    const dot = generateElastiCacheDot(stack);
    expect(dot).toContain('digraph ElastiCacheArchitecture');
    expect(dot).not.toContain('redis');
  });
});
