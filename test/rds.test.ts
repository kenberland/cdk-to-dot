import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { SubnetGroup } from '../lib/external';
import { generateDot } from '../lib/diagram';

function makeVpcStack() {
  const app = new App();
  const stack = new Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const vpc = new ec2.Vpc(stack, 'VpcA', {
    ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/22'),
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
  vpc.node.addMetadata('diagram:label', 'VPC-A');
  vpc.node.addMetadata('diagram:color', 'BLUE');
  return { stack, vpc };
}

describe('RDS in generateDot', () => {
  it('renders a DatabaseInstance as a cylinder node', () => {
    const { stack, vpc } = makeVpcStack();

    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet 10.0.0.0/24 (us-east-1a)',
      subtitle: '254 usable hosts',
    });

    const db = new rds.DatabaseInstance(az, 'DatabasePrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });
    db.node.addMetadata('diagram:label', 'Database (primary)');
    db.node.addMetadata('diagram:ip', '10.0.0.50');
    db.node.addMetadata('diagram:description', 'PostgreSQL RDS');

    const dot = generateDot(stack);

    // Should render as a cylinder (database shape)
    expect(dot).toContain('database_primary [');
    expect(dot).toContain('shape=cylinder');
    expect(dot).toContain('Database (primary)');
    expect(dot).toContain('10.0.0.50');
    expect(dot).toContain('PostgreSQL RDS');
  });

  it('renders a DatabaseInstance inside a subnet group cluster', () => {
    const { stack, vpc } = makeVpcStack();

    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet 10.0.0.0/24',
      subtitle: '254 hosts',
    });

    const db = new rds.DatabaseInstance(az, 'MyDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });
    db.node.addMetadata('diagram:label', 'My Database');

    const dot = generateDot(stack);

    // The DB node should appear inside the subnet cluster
    const clusterStart = dot.indexOf('subgraph cluster_az_a {');
    const clusterEnd = dot.indexOf('}', dot.indexOf('my_db ['));
    expect(clusterStart).toBeGreaterThan(-1);
    expect(dot.indexOf('my_db [')).toBeGreaterThan(clusterStart);
  });

  it('auto-detects engine from the RDS construct', () => {
    const { stack, vpc } = makeVpcStack();

    const db = new rds.DatabaseInstance(vpc, 'AutoDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });
    // No diagram:description metadata — should auto-detect from engine
    db.node.addMetadata('diagram:label', 'Auto DB');

    const dot = generateDot(stack);
    expect(dot).toContain('auto_db [');
    expect(dot).toContain('shape=cylinder');
  });

  it('renders a DatabaseInstanceReadReplica as a cylinder node', () => {
    const { stack, vpc } = makeVpcStack();

    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet 10.0.0.0/24',
      subtitle: '254 hosts',
    });

    const primary = new rds.DatabaseInstance(az, 'DbPrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });
    primary.node.addMetadata('diagram:label', 'DB Primary');

    const azB = new SubnetGroup(vpc, 'AzB', {
      label: 'Subnet 10.0.1.0/24',
      subtitle: '254 hosts',
    });

    const replica = new rds.DatabaseInstanceReadReplica(azB, 'DbReplica', {
      sourceDatabaseInstance: primary,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
    replica.node.addMetadata('diagram:label', 'DB Replica');

    const dot = generateDot(stack);
    expect(dot).toContain('db_primary [');
    expect(dot).toContain('db_replica [');
    expect(dot).toContain('shape=cylinder');
    expect(dot).toContain('DB Replica');
  });

  it('includes RDS instances in edge routing', () => {
    const { stack, vpc } = makeVpcStack();

    const az = new SubnetGroup(vpc, 'AzA', {
      label: 'Subnet',
      subtitle: 'hosts',
    });

    const dbPrimary = new rds.DatabaseInstance(az, 'DbPrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });
    dbPrimary.node.addMetadata('diagram:label', 'DB Primary');
    dbPrimary.node.addMetadata('diagram:connections', JSON.stringify([
      { target: 'DbStandby', label: 'sync replication', style: 'dashed', color: 'EDGE' },
    ]));

    const dbStandby = new rds.DatabaseInstance(az, 'DbStandby', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });
    dbStandby.node.addMetadata('diagram:label', 'DB Standby');

    const dot = generateDot(stack);
    expect(dot).toContain('db_primary -> db_standby [');
    expect(dot).toContain('sync replication');
  });
});
