import { App, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { SubnetGroup } from '../lib/external';
import { Database } from '../lib/database';
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

describe('Database construct', () => {
  it('creates a primary DatabaseInstance and a read replica', () => {
    const { stack, vpc } = makeVpcStack();
    const azA = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });
    const azB = new SubnetGroup(vpc, 'AzB', { label: 'AZ-B', subtitle: 'hosts' });

    const db = new Database(stack, 'Database', {
      vpc,
      primaryScope: azA,
      standbyScope: azB,
    });

    expect(db.primary).toBeInstanceOf(rds.DatabaseInstance);
    expect(db.standby).toBeInstanceOf(rds.DatabaseInstanceReadReplica);
  });

  it('attaches diagram metadata to primary and standby', () => {
    const { stack, vpc } = makeVpcStack();
    const azA = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });
    const azB = new SubnetGroup(vpc, 'AzB', { label: 'AZ-B', subtitle: 'hosts' });

    const db = new Database(stack, 'Database', {
      vpc,
      primaryScope: azA,
      standbyScope: azB,
    });

    expect(getMeta(db.primary, 'diagram:label')).toBe('Database (primary)');
    expect(getMeta(db.primary, 'diagram:ip')).toBe('10.0.0.50');
    expect(getMeta(db.primary, 'diagram:description')).toBe('PostgreSQL RDS');

    expect(getMeta(db.standby, 'diagram:label')).toBe('Database (standby)');
    expect(getMeta(db.standby, 'diagram:ip')).toBe('10.0.1.50');
    expect(getMeta(db.standby, 'diagram:description')).toBe('PostgreSQL RDS');
  });

  it('adds replication connection from primary to standby', () => {
    const { stack, vpc } = makeVpcStack();
    const azA = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });
    const azB = new SubnetGroup(vpc, 'AzB', { label: 'AZ-B', subtitle: 'hosts' });

    new Database(stack, 'Database', {
      vpc,
      primaryScope: azA,
      standbyScope: azB,
    });

    const dot = generateDot(stack);
    expect(dot).toContain('database_primary -> database_standby [');
    expect(dot).toContain('sync replication');
  });

  it('renders both instances as cylinders in the diagram', () => {
    const { stack, vpc } = makeVpcStack();
    const azA = new SubnetGroup(vpc, 'AzA', { label: 'AZ-A', subtitle: 'hosts' });
    const azB = new SubnetGroup(vpc, 'AzB', { label: 'AZ-B', subtitle: 'hosts' });

    new Database(stack, 'Database', {
      vpc,
      primaryScope: azA,
      standbyScope: azB,
    });

    const dot = generateDot(stack);
    expect(dot).toContain('database_primary [');
    expect(dot).toContain('database_standby [');

    // Both should be cylinders
    const primarySection = dot.substring(
      dot.indexOf('database_primary ['),
      dot.indexOf(']', dot.indexOf('database_primary [')) + 1,
    );
    expect(primarySection).toContain('shape=cylinder');

    const standbySection = dot.substring(
      dot.indexOf('database_standby ['),
      dot.indexOf(']', dot.indexOf('database_standby [')) + 1,
    );
    expect(standbySection).toContain('shape=cylinder');
  });
});
