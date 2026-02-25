import { Stack, StackProps, App } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import {
  Service,
  SubnetGroup,
  ExternalService,
  InternetNode,
  NatGatewayNode,
  addConnections,
} from './external';
import { subnetMeta } from './cidr';
import { Database } from './database';

export class NetworkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── Constants ────────────────────────────────────────────

    const VPC_A_CIDR = '10.0.0.0/22';
    const VPC_A_AZ_A_CIDR = '10.0.0.0/24';
    const VPC_A_AZ_B_CIDR = '10.0.1.0/24';
    const VPC_B_CIDR = '10.0.4.0/22';
    const NAT_A_EIP = '52.14.88.205';
    const NAT_B_EIP = '52.14.88.201';

    const FIREWALL_RULES = [
      { cidr: '203.0.113.10', cidrMask: '/32', label: 'Partner API' },
      { cidr: '198.51.100.0/28', cidrMask: '',  label: 'Office' },
      { cidr: '192.0.2.42',     cidrMask: '/32', label: 'Monitoring' },
      { cidr: '100.21.56.78',   cidrMask: '/32', label: 'CI/CD' },
    ];

    // ── VPCs ────────────────────────────────────────────────

    const vpcA = new ec2.Vpc(this, 'VpcA', {
      ipAddresses: ec2.IpAddresses.cidr(VPC_A_CIDR),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });
    vpcA.node.addMetadata('diagram:label', 'VPC-A');
    vpcA.node.addMetadata('diagram:subtitle', 'us-east-1 · Production');
    vpcA.node.addMetadata('diagram:color', 'BLUE');
    vpcA.node.addMetadata('diagram:titleOrder', '1');
    vpcA.node.addMetadata('diagram:titleLabel', 'VPC-A — Production');
    vpcA.node.addMetadata('diagram:note', [
      '• Public-facing production workloads',
      '• All inbound traffic filtered by firewall',
      `• Egress via NAT (fixed IP ${NAT_A_EIP})`,
      '• ELB distributes traffic across AZs',
      '• App servers call API A and API B',
      '• Multi-AZ database with read replica',
    ].join('\n'));

    const subnetB = subnetMeta(VPC_B_CIDR);
    const vpcB = new ec2.Vpc(this, 'VpcB', {
      ipAddresses: ec2.IpAddresses.cidr(VPC_B_CIDR),
      maxAzs: 1,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 26 },
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 },
      ],
    });
    vpcB.node.addMetadata('diagram:label', 'VPC-B');
    vpcB.node.addMetadata('diagram:subtitle', 'us-east-1 · Internal / Tooling');
    vpcB.node.addMetadata('diagram:color', 'GREEN');
    vpcB.node.addMetadata('diagram:subnet-label', subnetB.label);
    vpcB.node.addMetadata('diagram:subnet-subtitle', subnetB.subtitle);
    vpcB.node.addMetadata('diagram:titleOrder', '0');
    vpcB.node.addMetadata('diagram:titleLabel', 'VPC-B — Internal / Tooling');
    vpcB.node.addMetadata('diagram:note', [
      '• Not publicly accessible',
      `• Egress via NAT (fixed IP ${NAT_B_EIP})`,
      '• No inbound from Internet',
      '• CI/CD pulls packages via NAT gateway',
    ].join('\n'));

    // ── Firewall (Security Group on VPC-A) ───────────────────

    const firewall = new ec2.SecurityGroup(this, 'Firewall', {
      vpc: vpcA,
      description: 'IP Whitelist',
      allowAllOutbound: false,
    });
    for (const rule of FIREWALL_RULES) {
      const peerCidr = rule.cidr.includes('/') ? rule.cidr : `${rule.cidr}${rule.cidrMask}`;
      firewall.addIngressRule(ec2.Peer.ipv4(peerCidr), ec2.Port.allTraffic(), rule.label);
    }
    firewall.node.addMetadata('diagram:label', 'Firewall');
    firewall.node.addMetadata('diagram:description', 'IP Whitelist');
    firewall.node.addMetadata('diagram:rules', JSON.stringify(
      FIREWALL_RULES.map(r => ({ cidr: r.cidr, label: r.label })),
    ));

    // ── Internet ─────────────────────────────────────────────

    const internet = new InternetNode(this, 'Internet');

    // ── NAT Gateways ─────────────────────────────────────────

    const natA = new NatGatewayNode(this, 'NatA', { eip: NAT_A_EIP, color: 'BLUE' });
    const natB = new NatGatewayNode(this, 'NatB', { eip: NAT_B_EIP, color: 'GREEN' });

    // ── External APIs ────────────────────────────────────────

    const apiA = new ExternalService(this, 'ApiA', {
      label: 'API A',
      description: 'external service',
    });

    const apiB = new ExternalService(this, 'ApiB', {
      label: 'API B',
      description: 'external service',
    });

    // ── VPC-A: ELB (VPC-level, spans AZs) ──────────────────

    const elb = new Service(vpcA, 'Elb', {
      label: 'ELB',
      description: 'Application Load Balancer',
    });

    // ── VPC-A: AZ Subnets & Services ─────────────────────

    const azAMeta = subnetMeta(VPC_A_AZ_A_CIDR);
    const azA = new SubnetGroup(vpcA, 'AzA', {
      label: `${azAMeta.label} (us-east-1a)`,
      subtitle: azAMeta.subtitle,
    });

    const webServersA = new Service(azA, 'WebServersA', {
      label: 'Web Servers',
      ip: '10.0.0.10–12 (×3)',
      description: 'nginx + node.js',
    });

    const appServersA = new Service(azA, 'AppServersA', {
      label: 'App Servers',
      ip: '10.0.0.20–21 (×2)',
      description: 'Java / Spring Boot',
    });

    const redisA = new Service(azA, 'RedisA', {
      label: 'Redis Cache',
      ip: '10.0.0.100',
      description: 'ElastiCache node',
    });

    const azBMeta = subnetMeta(VPC_A_AZ_B_CIDR);
    const azB = new SubnetGroup(vpcA, 'AzB', {
      label: `${azBMeta.label} (us-east-1b)`,
      subtitle: azBMeta.subtitle,
    });

    const webServersB = new Service(azB, 'WebServersB', {
      label: 'Web Servers',
      ip: '10.0.1.10–12 (×3)',
      description: 'nginx + node.js',
    });

    const appServersB = new Service(azB, 'AppServersB', {
      label: 'App Servers',
      ip: '10.0.1.20–21 (×2)',
      description: 'Java / Spring Boot',
    });

    const redisB = new Service(azB, 'RedisB', {
      label: 'Redis Cache',
      ip: '10.0.1.100',
      description: 'ElastiCache node',
    });

    // ── Database (RDS PostgreSQL) ────────────────────────────

    const database = new Database(this, 'Database', {
      vpc: vpcA,
      primaryScope: azA,
      standbyScope: azB,
    });

    // ── VPC-B Services ───────────────────────────────────────

    const cicd = new Service(vpcB, 'CiCd', {
      label: 'CI/CD Runners',
      ip: '172.16.1.10–13 (×4)',
      description: 'Jenkins + GH Actions',
    });

    const monitoring = new Service(vpcB, 'Monitoring', {
      label: 'Monitoring',
      ip: '172.16.1.50',
      description: 'Prometheus + Grafana',
    });

    const artifacts = new Service(vpcB, 'Artifacts', {
      label: 'Artifacts',
      ip: '172.16.1.100',
      description: 'S3 object store',
    });

    const logs = new Service(vpcB, 'Logs', {
      label: 'Log Aggregator',
      ip: '172.16.1.200',
      description: 'ELK Stack',
    });

    // ── Connections ──────────────────────────────────────────

    addConnections(internet, [
      { target: 'Firewall', label: 'inbound (filtered)', style: 'dashed', color: 'FIREWALL', fontcolor: 'FIREWALL' },
      { target: 'ApiA', label: '', color: 'EDGE' },
      { target: 'ApiB', label: '', color: 'EDGE' },
    ]);

    addConnections(firewall, [
      { target: 'Elb', label: 'whitelisted traffic', color: 'FIREWALL', fontcolor: 'FIREWALL' },
    ]);

    addConnections(elb, [
      { target: 'WebServersA', label: '', color: 'EDGE' },
      { target: 'WebServersB', label: '', color: 'EDGE' },
    ]);

    addConnections(vpcA, [
      { target: 'NatA', label: 'egress via NAT', style: 'dashed', color: 'BLUE', fontcolor: 'BLUE' },
    ]);

    addConnections(natA, [
      {
        target: 'Internet',
        htmlLabel: `egress only<BR/><FONT POINT-SIZE="7">src IP: ${NAT_A_EIP}</FONT>`,
        color: 'BLUE', fontcolor: 'BLUE',
      },
    ]);

    // ── VPC-A internal flows (per-AZ) ────────────────────

    addConnections(webServersA, [
      { target: 'AppServersA', label: 'HTTP/gRPC', color: 'EDGE' },
    ]);

    addConnections(appServersA, [
      { target: 'DatabasePrimary', label: 'SQL', color: 'EDGE' },
      { target: 'RedisA', label: 'cache r/w', color: 'EDGE' },
    ]);

    addConnections(webServersB, [
      { target: 'AppServersB', label: 'HTTP/gRPC', color: 'EDGE' },
    ]);

    addConnections(appServersB, [
      { target: 'DatabasePrimary', label: 'SQL', color: 'EDGE' },
      { target: 'RedisB', label: 'cache r/w', color: 'EDGE' },
    ]);



    addConnections(vpcB, [
      { target: 'NatB', label: 'egress via NAT', style: 'dashed', color: 'GREEN', fontcolor: 'GREEN' },
    ]);

    addConnections(cicd, [
      { target: 'Artifacts', label: 'push builds', color: 'EDGE' },
    ]);

    addConnections(natB, [
      {
        target: 'Internet',
        htmlLabel: `egress only<BR/><FONT POINT-SIZE="7">src IP: ${NAT_B_EIP}</FONT>`,
        color: 'GREEN', fontcolor: 'GREEN',
      },
    ]);

    addConnections(monitoring, [
      { target: 'Logs', label: 'alerts', color: 'EDGE' },
    ]);
  }
}
