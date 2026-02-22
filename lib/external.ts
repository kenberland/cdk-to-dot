import { Construct } from 'constructs';

export interface DiagramNodeProps {
  label: string;
  ip?: string;
  description?: string;
  shape?: string;
  style?: string;
}

/** Lightweight construct for services inside a VPC (no real AWS resources). */
export class Service extends Construct {
  constructor(scope: Construct, id: string, props: DiagramNodeProps) {
    super(scope, id);
    this.node.addMetadata('diagram:label', props.label);
    if (props.ip) this.node.addMetadata('diagram:ip', props.ip);
    if (props.description) this.node.addMetadata('diagram:description', props.description);
    if (props.shape) this.node.addMetadata('diagram:shape', props.shape);
    if (props.style) this.node.addMetadata('diagram:style', props.style);
  }
}

/** Lightweight construct for external nodes outside any VPC (APIs, etc). */
export class ExternalService extends Construct {
  constructor(scope: Construct, id: string, props: DiagramNodeProps) {
    super(scope, id);
    this.node.addMetadata('diagram:label', props.label);
    if (props.ip) this.node.addMetadata('diagram:ip', props.ip);
    if (props.description) this.node.addMetadata('diagram:description', props.description);
    if (props.shape) this.node.addMetadata('diagram:shape', props.shape);
    if (props.style) this.node.addMetadata('diagram:style', props.style);
  }
}

/** The cloud/internet node — rendered with a cloud image in DOT. */
export class InternetNode extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
  }
}

/** Groups services into a named subnet/AZ within a VPC. */
export class SubnetGroup extends Construct {
  constructor(scope: Construct, id: string, props: { label: string; subtitle: string }) {
    super(scope, id);
    this.node.addMetadata('diagram:label', props.label);
    this.node.addMetadata('diagram:subtitle', props.subtitle);
  }
}

/** NAT Gateway diagram node (not a real AWS NatGateway — just metadata). */
export class NatGatewayNode extends Construct {
  constructor(scope: Construct, id: string, props: { eip: string; color: string }) {
    super(scope, id);
    this.node.addMetadata('diagram:label', 'NAT Gateway');
    this.node.addMetadata('diagram:ip', `EIP: ${props.eip}`);
    this.node.addMetadata('diagram:color', props.color);
  }
}

export interface Connection {
  target: string;
  label?: string;
  htmlLabel?: string;
  style?: string;
  color?: string;
  fontcolor?: string;
  /** DOT ltail — visually originate edge from a cluster boundary. */
  ltail?: string;
}

/** Helper to add outgoing connections as metadata on a construct. */
export function addConnections(construct: Construct, connections: Connection[]) {
  construct.node.addMetadata('diagram:connections', JSON.stringify(connections));
}
