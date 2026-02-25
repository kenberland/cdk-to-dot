import { App, Stack } from 'aws-cdk-lib';
import {
  Service,
  ExternalService,
  InternetNode,
  SubnetGroup,
  NatGatewayNode,
  addConnections,
  Connection,
} from '../lib/external';

function makeStack(): Stack {
  const app = new App();
  return new Stack(app, 'TestStack');
}

function getMeta(construct: any, key: string): string | undefined {
  const entry = construct.node.metadata.find((e: any) => e.type === key);
  return entry?.data as string | undefined;
}

describe('Service', () => {
  it('stores label metadata', () => {
    const stack = makeStack();
    const svc = new Service(stack, 'MySvc', { label: 'My Service' });
    expect(getMeta(svc, 'diagram:label')).toBe('My Service');
  });

  it('stores optional ip, description, shape, style metadata', () => {
    const stack = makeStack();
    const svc = new Service(stack, 'Full', {
      label: 'Full Service',
      ip: '10.0.0.1',
      description: 'a service',
      shape: 'cylinder',
      style: 'filled',
    });
    expect(getMeta(svc, 'diagram:ip')).toBe('10.0.0.1');
    expect(getMeta(svc, 'diagram:description')).toBe('a service');
    expect(getMeta(svc, 'diagram:shape')).toBe('cylinder');
    expect(getMeta(svc, 'diagram:style')).toBe('filled');
  });

  it('omits optional metadata when not provided', () => {
    const stack = makeStack();
    const svc = new Service(stack, 'Minimal', { label: 'Minimal' });
    expect(getMeta(svc, 'diagram:ip')).toBeUndefined();
    expect(getMeta(svc, 'diagram:description')).toBeUndefined();
    expect(getMeta(svc, 'diagram:shape')).toBeUndefined();
    expect(getMeta(svc, 'diagram:style')).toBeUndefined();
  });
});

describe('ExternalService', () => {
  it('stores label and optional metadata', () => {
    const stack = makeStack();
    const ext = new ExternalService(stack, 'ExtApi', {
      label: 'API A',
      description: 'external service',
    });
    expect(getMeta(ext, 'diagram:label')).toBe('API A');
    expect(getMeta(ext, 'diagram:description')).toBe('external service');
    expect(getMeta(ext, 'diagram:ip')).toBeUndefined();
  });
});

describe('InternetNode', () => {
  it('creates a construct with no metadata', () => {
    const stack = makeStack();
    const inet = new InternetNode(stack, 'Internet');
    expect(inet.node.id).toBe('Internet');
    expect(inet.node.metadata.filter(m => m.type.startsWith('diagram:'))).toHaveLength(0);
  });
});

describe('SubnetGroup', () => {
  it('stores label and subtitle metadata', () => {
    const stack = makeStack();
    const sg = new SubnetGroup(stack, 'AzA', {
      label: 'Subnet 10.0.0.0/24',
      subtitle: '254 usable hosts',
    });
    expect(getMeta(sg, 'diagram:label')).toBe('Subnet 10.0.0.0/24');
    expect(getMeta(sg, 'diagram:subtitle')).toBe('254 usable hosts');
  });
});

describe('NatGatewayNode', () => {
  it('stores label, ip with EIP prefix, and color', () => {
    const stack = makeStack();
    const nat = new NatGatewayNode(stack, 'NatA', {
      eip: '52.14.88.205',
      color: 'BLUE',
    });
    expect(getMeta(nat, 'diagram:label')).toBe('NAT Gateway');
    expect(getMeta(nat, 'diagram:ip')).toBe('EIP: 52.14.88.205');
    expect(getMeta(nat, 'diagram:color')).toBe('BLUE');
  });
});

describe('addConnections', () => {
  it('serializes connections as JSON metadata', () => {
    const stack = makeStack();
    const svc = new Service(stack, 'Src', { label: 'Source' });
    const connections: Connection[] = [
      { target: 'Dest', label: 'HTTP', color: 'EDGE' },
      { target: 'Other', style: 'dashed' },
    ];
    addConnections(svc, connections);

    const raw = getMeta(svc, 'diagram:connections');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].target).toBe('Dest');
    expect(parsed[0].label).toBe('HTTP');
    expect(parsed[1].style).toBe('dashed');
  });

  it('handles htmlLabel and ltail fields', () => {
    const stack = makeStack();
    const svc = new Service(stack, 'Src2', { label: 'Source' });
    addConnections(svc, [
      { target: 'T', htmlLabel: '<B>bold</B>', ltail: 'cluster_vpc' },
    ]);
    const parsed = JSON.parse(getMeta(svc, 'diagram:connections')!);
    expect(parsed[0].htmlLabel).toBe('<B>bold</B>');
    expect(parsed[0].ltail).toBe('cluster_vpc');
  });
});
