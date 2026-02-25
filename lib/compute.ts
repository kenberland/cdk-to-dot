import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { addConnections, Connection } from './external';

export interface ServerFleetProps {
  vpc: ec2.Vpc;
  /** Construct to scope instances under (e.g. a SubnetGroup). */
  scope: Construct;
  /** Construct ID for the fleet (e.g. 'WebServersA'). */
  id: string;
  /** Number of instances to create. */
  count: number;
  instanceType: ec2.InstanceType;
  machineImage: ec2.IMachineImage;
  /** Diagram label (e.g. 'Web Servers'). */
  label: string;
  /** Diagram IP range (e.g. '10.0.0.10–12 (×3)'). */
  ip: string;
  /** Diagram description (e.g. 'nginx + node.js'). */
  description: string;
  /** Outgoing connections for the diagram. */
  connections?: Connection[];
  /** Additional security groups. */
  securityGroups?: ec2.ISecurityGroup[];
}

/**
 * Creates a fleet of EC2 instances with shared config and diagram metadata.
 * The first instance carries the diagram metadata and connections so the
 * fleet appears as a single node in diagrams.
 */
export class ServerFleet extends Construct {
  public readonly instances: ec2.Instance[];
  /** The lead instance that carries diagram metadata. */
  public readonly lead: ec2.Instance;

  constructor(props: ServerFleetProps) {
    super(props.scope, props.id);

    const sg = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: `${props.label} security group`,
    });

    this.instances = [];
    for (let i = 0; i < props.count; i++) {
      const instance = new ec2.Instance(this, `Instance${i}`, {
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        instanceType: props.instanceType,
        machineImage: props.machineImage,
        securityGroup: sg,
      });
      this.instances.push(instance);
    }

    this.lead = this.instances[0];

    // Diagram metadata on the fleet construct itself
    this.node.addMetadata('diagram:label', props.label);
    this.node.addMetadata('diagram:ip', props.ip);
    this.node.addMetadata('diagram:description', props.description);
    this.node.addMetadata('diagram:instanceType', props.instanceType.toString());
    this.node.addMetadata('diagram:count', String(props.count));

    if (props.connections) {
      addConnections(this, props.connections);
    }
  }
}
