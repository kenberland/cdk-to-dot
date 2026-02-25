import { App, Stack } from 'aws-cdk-lib';
import { getMeta, toNodeId, COLOR_SCHEMES } from '../lib/dot-helpers';

describe('toNodeId', () => {
  it('converts camelCase to snake_case', () => {
    expect(toNodeId('WebServersA')).toBe('web_servers_a');
    expect(toNodeId('DatabasePrimary')).toBe('database_primary');
    expect(toNodeId('NatA')).toBe('nat_a');
  });

  it('handles already lowercase', () => {
    expect(toNodeId('internet')).toBe('internet');
  });

  it('handles single word', () => {
    expect(toNodeId('Elb')).toBe('elb');
  });
});

describe('getMeta', () => {
  it('returns metadata value by key', () => {
    const app = new App();
    const stack = new Stack(app, 'S');
    stack.node.addMetadata('diagram:label', 'Test');
    expect(getMeta(stack, 'diagram:label')).toBe('Test');
  });

  it('returns undefined for missing key', () => {
    const app = new App();
    const stack = new Stack(app, 'S');
    expect(getMeta(stack, 'diagram:missing')).toBeUndefined();
  });
});

describe('COLOR_SCHEMES', () => {
  it('has BLUE and GREEN schemes', () => {
    expect(COLOR_SCHEMES.BLUE).toBeDefined();
    expect(COLOR_SCHEMES.GREEN).toBeDefined();
    expect(COLOR_SCHEMES.BLUE.main).toBe('BLUE');
    expect(COLOR_SCHEMES.GREEN.main).toBe('GREEN');
  });
});
