import { parseCidr, subnetMeta } from '../lib/cidr';

describe('parseCidr', () => {
  it('parses a /24 network', () => {
    const result = parseCidr('10.0.0.0/24');
    expect(result.cidr).toBe('10.0.0.0/24');
    expect(result.network).toBe('10.0.0.0');
    expect(result.prefix).toBe(24);
    expect(result.usableHosts).toBe('254');
    expect(result.firstUsable).toBe('10.0.0.1');
    expect(result.lastUsable).toBe('10.0.0.254');
  });

  it('parses a /22 network', () => {
    const result = parseCidr('10.0.0.0/22');
    expect(result.cidr).toBe('10.0.0.0/22');
    expect(result.network).toBe('10.0.0.0');
    expect(result.prefix).toBe(22);
    expect(result.usableHosts).toBe('1,022');
    expect(result.firstUsable).toBe('10.0.0.1');
    expect(result.lastUsable).toBe('10.0.3.254');
  });

  it('parses a /26 network', () => {
    const result = parseCidr('10.0.4.0/26');
    expect(result.network).toBe('10.0.4.0');
    expect(result.prefix).toBe(26);
    expect(result.usableHosts).toBe('62');
    expect(result.firstUsable).toBe('10.0.4.1');
    expect(result.lastUsable).toBe('10.0.4.62');
  });

  it('parses a /32 single host', () => {
    const result = parseCidr('203.0.113.10/32');
    expect(result.network).toBe('203.0.113.10');
    expect(result.prefix).toBe(32);
    expect(result.usableHosts).toBe('-1');
    expect(result.firstUsable).toBe('203.0.113.11');
    expect(result.lastUsable).toBe('203.0.113.9');
  });

  it('parses a /16 network', () => {
    const result = parseCidr('172.16.0.0/16');
    expect(result.network).toBe('172.16.0.0');
    expect(result.prefix).toBe(16);
    expect(result.usableHosts).toBe('65,534');
    expect(result.firstUsable).toBe('172.16.0.1');
    expect(result.lastUsable).toBe('172.16.255.254');
  });

  it('handles non-zero host bits in input (normalizes to network)', () => {
    const result = parseCidr('10.0.1.50/24');
    expect(result.network).toBe('10.0.1.0');
    expect(result.firstUsable).toBe('10.0.1.1');
    expect(result.lastUsable).toBe('10.0.1.254');
  });
});

describe('subnetMeta', () => {
  it('returns label and subtitle for a /24', () => {
    const meta = subnetMeta('10.0.0.0/24');
    expect(meta.label).toBe('Subnet 10.0.0.0/24');
    expect(meta.subtitle).toBe('254 usable hosts · 10.0.0.1–10.0.0.254');
  });

  it('returns label and subtitle for a /22', () => {
    const meta = subnetMeta('10.0.4.0/22');
    expect(meta.label).toBe('Subnet 10.0.4.0/22');
    expect(meta.subtitle).toBe('1,022 usable hosts · 10.0.4.1–10.0.7.254');
  });
});
