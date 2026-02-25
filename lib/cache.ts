import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

export interface CacheNodeProps {
  vpc: ec2.Vpc;
  /** Diagram label (e.g. 'Redis Cache'). */
  label: string;
  /** Diagram IP address. */
  ip?: string;
  /** Diagram description. */
  description?: string;
  /** Cache node type (default: cache.t3.micro). */
  cacheNodeType?: string;
  /** Number of cache nodes (default: 1). */
  numCacheNodes?: number;
  /** Engine version (default: '7.2'). */
  engineVersion?: string;
}

/**
 * Creates a Valkey ElastiCache cluster with subnet group, security group,
 * and diagram metadata.
 */
export class CacheNode extends Construct {
  public readonly cluster: elasticache.CfnCacheCluster;
  public readonly subnetGroup: elasticache.CfnSubnetGroup;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: CacheNodeProps) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: `${props.label} security group`,
    });

    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Valkey from VPC',
    );

    const subnets = props.vpc.isolatedSubnets.length > 0
      ? props.vpc.isolatedSubnets
      : props.vpc.privateSubnets;

    this.subnetGroup = new elasticache.CfnSubnetGroup(this, 'SubnetGroup', {
      description: `${props.label} subnet group`,
      subnetIds: subnets.map(s => s.subnetId),
    });

    this.cluster = new elasticache.CfnCacheCluster(this, 'Cluster', {
      engine: 'valkey',
      engineVersion: props.engineVersion || '7.2',
      cacheNodeType: props.cacheNodeType || 'cache.t3.micro',
      numCacheNodes: props.numCacheNodes || 1,
      cacheSubnetGroupName: this.subnetGroup.ref,
      vpcSecurityGroupIds: [this.securityGroup.securityGroupId],
    });

    // Diagram metadata on the CacheNode construct
    this.node.addMetadata('diagram:label', props.label);
    if (props.ip) this.node.addMetadata('diagram:ip', props.ip);
    if (props.description) this.node.addMetadata('diagram:description', props.description);
    this.node.addMetadata('diagram:engine', 'valkey');
    this.node.addMetadata('diagram:engineVersion', props.engineVersion || '7.2');
    this.node.addMetadata('diagram:cacheNodeType', props.cacheNodeType || 'cache.t3.micro');
    this.node.addMetadata('diagram:numCacheNodes', String(props.numCacheNodes || 1));
  }
}
