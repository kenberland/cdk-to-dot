import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {
  Service,
  ExternalService,
  InternetNode,
  SubnetGroup,
  NatGatewayNode,
  addConnections,
} from '../lib/external';
import { generateDot } from '../lib/diagram';

function makeStack(): Stack {
  const app = new App();
  return new Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
}

describe('generateDot', () => {
  it('produces a valid digraph wrapper', () => {
    const stack = makeStack();
    const dot = generateDot(stack);
    expect(dot).toMatch(/^digraph NetworkArchitecture \{/);
    expect(dot.trimEnd()).toMatch(/\}$/);
  });

  it('includes global graph settings', () => {
    const stack = makeStack();
    const dot = generateDot(stack);
    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain('compound=true');
    expect(dot).toContain('fontname="Helvetica"');
  });

  it('renders an internet node', () => {
    const stack = makeStack();
    new InternetNode(stack, 'Internet');
    const dot = generateDot(stack);
    expect(dot).toContain('internet [');
    expect(dot).toContain('image="CLOUD_IMAGE"');
    expect(dot).toContain('shape=none');
  });

  it('does not render internet node when absent', () => {
    const stack = makeStack();
    const dot = generateDot(stack);
    expect(dot).not.toContain('internet [');
  });

  it('renders external services', () => {
    const stack = makeStack();
    const api = new ExternalService(stack, 'ApiA', {
      label: 'API A',
      description: 'external service',
    });
    const dot = generateDot(stack);
    expect(dot).toContain('api_a [');
    expect(dot).toContain('API A');
    expect(dot).toContain('external service');
    expect(dot).toContain('shape=box');
    expect(dot).toContain('style="filled,rounded"');
  });

  it('renders a VPC as a subgraph cluster', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:subtitle', 'us-east-1');
    vpc.node.addMetadata('diagram:color', 'BLUE');

    const dot = generateDot(stack);
    expect(dot).toContain('subgraph cluster_vpc_a {');
    expect(dot).toContain('VPC-A');
    expect(dot).toContain('us-east-1');
  });

  it('renders services inside a VPC', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:color', 'BLUE');
    vpc.node.addMetadata('diagram:subnet-label', 'Subnet 10.0.0.0/24');
    vpc.node.addMetadata('diagram:subnet-subtitle', '254 hosts');

    new Service(vpc, 'WebServer', {
      label: 'Web Server',
      ip: '10.0.0.10',
      description: 'nginx',
    });

    const dot = generateDot(stack);
    expect(dot).toContain('web_server [');
    expect(dot).toContain('Web Server');
    expect(dot).toContain('10.0.0.10');
    expect(dot).toContain('nginx');
  });

  it('renders subnet groups within a VPC', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:color', 'BLUE');

    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet 10.0.0.0/24 (us-east-1a)',
      subtitle: '254 usable hosts',
    });

    new Service(az, 'AppServer', {
      label: 'App Server',
      ip: '10.0.0.20',
    });

    const dot = generateDot(stack);
    expect(dot).toContain('subgraph cluster_az_a {');
    expect(dot).toContain('Subnet 10.0.0.0/24 (us-east-1a)');
    expect(dot).toContain('app_server [');
  });

  it('renders NAT gateways with color scheme', () => {
    const stack = makeStack();
    new NatGatewayNode(stack, 'NatA', { eip: '52.14.88.205', color: 'BLUE' });
    const dot = generateDot(stack);
    expect(dot).toContain('nat_a [');
    expect(dot).toContain('NAT Gateway');
    expect(dot).toContain('EIP: 52.14.88.205');
    expect(dot).toContain('fillcolor="BLUE_ALT_FILL"');
  });

  it('renders a security group as a firewall node', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:color', 'BLUE');

    const sg = new ec2.SecurityGroup(stack, 'Firewall', {
      vpc,
      description: 'IP Whitelist',
      allowAllOutbound: false,
    });
    sg.node.addMetadata('diagram:label', 'Firewall');
    sg.node.addMetadata('diagram:description', 'IP Whitelist');
    sg.node.addMetadata('diagram:rules', JSON.stringify([
      { cidr: '203.0.113.10', label: 'Partner API' },
    ]));

    const dot = generateDot(stack);
    expect(dot).toContain('firewall [');
    expect(dot).toContain('Firewall');
    expect(dot).toContain('IP Whitelist');
    expect(dot).toContain('203.0.113.10 (Partner API)');
    expect(dot).toContain('fillcolor="FIREWALL_FILL"');
  });

  it('renders edges between nodes', () => {
    const stack = makeStack();
    const inet = new InternetNode(stack, 'Internet');
    const api = new ExternalService(stack, 'ApiA', { label: 'API A' });

    addConnections(inet, [
      { target: 'ApiA', label: 'outbound', color: 'EDGE' },
    ]);

    const dot = generateDot(stack);
    expect(dot).toContain('internet -> api_a [');
    expect(dot).toContain('label="outbound"');
    expect(dot).toContain('color="EDGE"');
  });

  it('renders edges with htmlLabel', () => {
    const stack = makeStack();
    new NatGatewayNode(stack, 'NatA', { eip: '1.2.3.4', color: 'BLUE' });
    new InternetNode(stack, 'Internet');

    addConnections(stack.node.findChild('NatA') as any, [
      {
        target: 'Internet',
        htmlLabel: 'egress only<BR/><FONT POINT-SIZE="7">src IP: 1.2.3.4</FONT>',
        color: 'BLUE',
      },
    ]);

    const dot = generateDot(stack);
    expect(dot).toContain('nat_a -> internet [');
    expect(dot).toContain('label=<egress only<BR/><FONT POINT-SIZE="7">src IP: 1.2.3.4</FONT>>');
  });

  it('renders dashed edge style', () => {
    const stack = makeStack();
    new InternetNode(stack, 'Internet');
    new ExternalService(stack, 'ApiA', { label: 'API A' });

    addConnections(stack.node.findChild('Internet') as any, [
      { target: 'ApiA', label: 'test', style: 'dashed', color: 'EDGE' },
    ]);

    const dot = generateDot(stack);
    expect(dot).toContain('style=dashed');
  });

  it('renders VPC-sourced edges using anchor node with ltail', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:color', 'BLUE');

    new NatGatewayNode(stack, 'NatA', { eip: '1.2.3.4', color: 'BLUE' });

    addConnections(vpc, [
      { target: 'NatA', label: 'egress via NAT', color: 'BLUE' },
    ]);

    const dot = generateDot(stack);
    // VPC connections get rewritten to use anchor node
    expect(dot).toContain('_anchor_a -> nat_a [');
    expect(dot).toContain('ltail=cluster_vpc_a');
  });

  it('renders cylinder shape for database services', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:color', 'BLUE');
    vpc.node.addMetadata('diagram:subnet-label', 'Subnet');
    vpc.node.addMetadata('diagram:subnet-subtitle', 'hosts');

    new Service(vpc, 'Database', {
      label: 'Database',
      shape: 'cylinder',
    });

    const dot = generateDot(stack);
    expect(dot).toContain('shape=cylinder');
    // cylinder uses 'filled' not 'filled,rounded'
    expect(dot).toMatch(/database \[[\s\S]*?style="filled"/);
  });

  it('renders title label with VPC notes', () => {
    const stack = makeStack();
    const vpc = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.node.addMetadata('diagram:label', 'VPC-A');
    vpc.node.addMetadata('diagram:color', 'BLUE');
    vpc.node.addMetadata('diagram:titleOrder', '0');
    vpc.node.addMetadata('diagram:titleLabel', 'VPC-A — Production');
    vpc.node.addMetadata('diagram:note', '• Production workloads\n• Multi-AZ');

    const dot = generateDot(stack);
    expect(dot).toContain('Network Architecture');
    expect(dot).toContain('VPC-A — Production');
    expect(dot).toContain('Production workloads');
  });

  it('sorts VPCs by titleOrder in the title label', () => {
    const stack = makeStack();

    const vpcA = new ec2.Vpc(stack, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpcA.node.addMetadata('diagram:label', 'VPC-A');
    vpcA.node.addMetadata('diagram:color', 'BLUE');
    vpcA.node.addMetadata('diagram:titleOrder', '1');
    vpcA.node.addMetadata('diagram:titleLabel', 'VPC-A — Prod');

    const vpcB = new ec2.Vpc(stack, 'VpcB', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.4.0/22'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpcB.node.addMetadata('diagram:label', 'VPC-B');
    vpcB.node.addMetadata('diagram:color', 'GREEN');
    vpcB.node.addMetadata('diagram:titleOrder', '0');
    vpcB.node.addMetadata('diagram:titleLabel', 'VPC-B — Internal');

    const dot = generateDot(stack);
    const posA = dot.indexOf('VPC-A — Prod');
    const posB = dot.indexOf('VPC-B — Internal');
    // VPC-B has titleOrder 0, should appear first in the title
    expect(posB).toBeLessThan(posA);
  });

  it('renders GREEN color scheme for VPC-B', () => {
    const stack = makeStack();
    new NatGatewayNode(stack, 'NatB', { eip: '52.14.88.201', color: 'GREEN' });
    const dot = generateDot(stack);
    expect(dot).toContain('fillcolor="GREEN_FILL"');
    expect(dot).toContain('color="GREEN"');
  });
});
