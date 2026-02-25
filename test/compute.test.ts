import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SubnetGroup } from '../lib/external';
import { ServerFleet } from '../lib/compute';
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

describe('ServerFleet construct', () => {
  it('creates the specified number of EC2 instances', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const fleet = new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServers',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12 (×3)',
      description: 'nginx + node.js',
    });

    expect(fleet.instances).toHaveLength(3);
    fleet.instances.forEach(inst => {
      expect(inst).toBeInstanceOf(ec2.Instance);
    });
  });

  it('attaches diagram metadata', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const fleet = new ServerFleet({
      vpc,
      scope: az,
      id: 'AppServers',
      count: 2,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'App Servers',
      ip: '10.0.0.20–21 (×2)',
      description: 'Java / Spring Boot',
    });

    expect(getMeta(fleet, 'diagram:label')).toBe('App Servers');
    expect(getMeta(fleet, 'diagram:ip')).toBe('10.0.0.20–21 (×2)');
    expect(getMeta(fleet, 'diagram:description')).toBe('Java / Spring Boot');
    expect(getMeta(fleet, 'diagram:instanceType')).toBe('t3.large');
    expect(getMeta(fleet, 'diagram:count')).toBe('2');
  });

  it('attaches connections when provided', () => {
    const { vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const fleet = new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServers',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12',
      description: 'nginx',
      connections: [
        { target: 'AppServers', label: 'HTTP', color: 'EDGE' },
      ],
    });

    const connMeta = getMeta(fleet, 'diagram:connections');
    expect(connMeta).toBeDefined();
    const parsed = JSON.parse(connMeta!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].target).toBe('AppServers');
  });
});

describe('ServerFleet in generateDot', () => {
  it('renders a ServerFleet as a node in the network diagram', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServersA',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12 (×3)',
      description: 'nginx + node.js',
    });

    const dot = generateDot(stack);
    expect(dot).toContain('web_servers_a [');
    expect(dot).toContain('Web Servers');
    expect(dot).toContain('10.0.0.10');
    expect(dot).toContain('nginx + node.js');
  });

  it('renders edges from ServerFleet connections', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServersA',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12',
      description: 'nginx',
      connections: [
        { target: 'AppServersA', label: 'HTTP/gRPC', color: 'EDGE' },
      ],
    });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'AppServersA',
      count: 2,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'App Servers',
      ip: '10.0.0.20–21',
      description: 'Java',
    });

    const dot = generateDot(stack);
    expect(dot).toContain('web_servers_a -> app_servers_a [');
    expect(dot).toContain('HTTP/gRPC');
  });

  it('renders ServerFleet inside a subnet group cluster', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet 10.0.0.0/24',
      subtitle: '254 hosts',
    });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServersA',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12',
      description: 'nginx',
    });

    const dot = generateDot(stack);
    const clusterStart = dot.indexOf('subgraph cluster_az_a {');
    const nodePos = dot.indexOf('web_servers_a [');
    expect(clusterStart).toBeGreaterThan(-1);
    expect(nodePos).toBeGreaterThan(clusterStart);
  });
});
