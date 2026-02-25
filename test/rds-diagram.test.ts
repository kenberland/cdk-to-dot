import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { SubnetGroup, addConnections } from '../lib/external';
import { generateRdsDot } from '../lib/rds-diagram';

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

describe('generateRdsDot', () => {
  it('produces a valid digraph', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new rds.DatabaseInstance(az, 'DbPrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
    });

    const dot = generateRdsDot(stack);
    expect(dot).toMatch(/^digraph RDSArchitecture \{/);
    expect(dot.trimEnd()).toMatch(/\}$/);
  });

  it('includes RDS title', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    new rds.DatabaseInstance(az, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
    });

    const dot = generateRdsDot(stack);
    expect(dot).toContain('RDS Database Architecture');
  });

  it('renders database node with config details', () => {
    const { stack, vpc } = makeVpcStack();
    const az = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });

    const db = new rds.DatabaseInstance(az, 'DbPrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      allocatedStorage: 20,
    });
    db.node.addMetadata('diagram:label', 'Database (primary)');
    db.node.addMetadata('diagram:ip', '10.0.0.50');

    const dot = generateRdsDot(stack);
    expect(dot).toContain('db_primary [');
    expect(dot).toContain('Database (primary)');
    expect(dot).toContain('10.0.0.50');
    expect(dot).toContain('Engine');
    expect(dot).toContain('Instance');
    expect(dot).toContain('Multi-AZ');
  });

  it('renders replication edges between databases', () => {
    const { stack, vpc } = makeVpcStack();
    const azA = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });
    const azB = new SubnetGroup(vpc, 'AzB', { label: 'AZ-B', subtitle: 'hosts' });

    const primary = new rds.DatabaseInstance(azA, 'DbPrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
    });
    primary.node.addMetadata('diagram:label', 'DB Primary');

    const replica = new rds.DatabaseInstanceReadReplica(azB, 'DbStandby', {
      sourceDatabaseInstance: primary,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
    replica.node.addMetadata('diagram:label', 'DB Standby');

    addConnections(primary, [
      { target: 'DbStandby', label: 'sync replication', style: 'dashed', color: 'EDGE' },
    ]);

    const dot = generateRdsDot(stack);
    expect(dot).toContain('db_primary -> db_standby [');
    expect(dot).toContain('sync replication');
  });

  it('shows VPC placement', () => {
    const { stack, vpc } = makeVpcStack();

    const db = new rds.DatabaseInstance(vpc, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
    });
    db.node.addMetadata('diagram:label', 'My DB');

    const dot = generateRdsDot(stack);
    expect(dot).toContain('VPC');
    expect(dot).toContain('VPC-A');
  });

  it('produces empty diagram when no RDS instances exist', () => {
    const { stack } = makeVpcStack();
    const dot = generateRdsDot(stack);
    expect(dot).toContain('digraph RDSArchitecture');
    expect(dot).not.toContain('db_');
  });
});
