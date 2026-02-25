import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SubnetGroup } from '../lib/external';
import { ServerFleet } from '../lib/compute';
import { generateEc2Dot } from '../lib/ec2-diagram';

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

describe('generateEc2Dot', () => {
  it('produces a valid digraph', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServers',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12',
      description: 'nginx',
    });

    const dot = generateEc2Dot(stack);
    expect(dot).toMatch(/^digraph EC2Architecture \{/);
    expect(dot.trimEnd()).toMatch(/\}$/);
  });

  it('includes EC2 title', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'WebServers',
      count: 3,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'Web Servers',
      ip: '10.0.0.10–12',
      description: 'nginx',
    });

    const dot = generateEc2Dot(stack);
    expect(dot).toContain('EC2 Compute Architecture');
  });

  it('renders fleet node with instance type and count', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new ServerFleet({
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

    const dot = generateEc2Dot(stack);
    expect(dot).toContain('web_servers [');
    expect(dot).toContain('Web Servers');
    expect(dot).toContain('t3.medium');
    expect(dot).toContain('Instance Type');
    expect(dot).toContain('Count');
    expect(dot).toContain('>3<');
  });

  it('shows VPC and subnet placement', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'Subnet 10.0.0.0/24', subtitle: 'hosts' });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'AppServers',
      count: 2,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'App Servers',
      ip: '10.0.0.20–21',
      description: 'Java',
    });

    const dot = generateEc2Dot(stack);
    expect(dot).toContain('VPC-A');
    expect(dot).toContain('Subnet 10.0.0.0/24');
  });

  it('renders edges between fleets', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new ServerFleet({
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
        { target: 'AppServers', label: 'HTTP/gRPC', color: 'EDGE' },
      ],
    });

    new ServerFleet({
      vpc,
      scope: az,
      id: 'AppServers',
      count: 2,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      label: 'App Servers',
      ip: '10.0.0.20–21',
      description: 'Java',
    });

    const dot = generateEc2Dot(stack);
    expect(dot).toContain('web_servers -> app_servers [');
    expect(dot).toContain('HTTP/gRPC');
  });

  it('produces empty diagram when no fleets exist', () => {
    const { stack } = makeVpcStack();
    const dot = generateEc2Dot(stack);
    expect(dot).toContain('digraph EC2Architecture');
    expect(dot).not.toContain('web_servers');
  });
});
