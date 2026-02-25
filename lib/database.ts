import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { addConnections } from './external';

export interface DatabaseProps {
  vpc: ec2.Vpc;
  /** Construct to scope the primary instance under (e.g. a SubnetGroup). */
  primaryScope: Construct;
  /** Construct to scope the standby instance under. */
  standbyScope: Construct;
}

/**
 * Creates a primary + standby PostgreSQL RDS pair with diagram metadata.
 * The standby is a read replica of the primary.
 */
export class Database extends Construct {
  public readonly primary: rds.DatabaseInstance;
  public readonly standby: rds.DatabaseInstanceReadReplica;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: props.vpc,
      description: 'RDS database access',
      allowAllOutbound: false,
    });

    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'PostgreSQL from VPC',
    );

    this.primary = new rds.DatabaseInstance(props.primaryScope, 'DatabasePrimary', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      databaseName: 'app',
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    this.primary.node.addMetadata('diagram:label', 'Database (primary)');
    this.primary.node.addMetadata('diagram:ip', '10.0.0.50');
    this.primary.node.addMetadata('diagram:description', 'PostgreSQL RDS');

    this.standby = new rds.DatabaseInstanceReadReplica(props.standbyScope, 'DatabaseStandby', {
      sourceDatabaseInstance: this.primary,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    this.standby.node.addMetadata('diagram:label', 'Database (standby)');
    this.standby.node.addMetadata('diagram:ip', '10.0.1.50');
    this.standby.node.addMetadata('diagram:description', 'PostgreSQL RDS');

    addConnections(this.primary, [
      { target: 'DatabaseStandby', label: 'sync replication', style: 'dashed', color: 'EDGE' },
    ]);
  }
}
