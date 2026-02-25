export function parseCidr(cidr: string) {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const octets = ip.split('.').map(Number);
  const addr = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const hostBits = 32 - prefix;
  const totalHosts = 1 << hostBits;
  const networkAddr = (addr & (~0 << hostBits)) >>> 0;
  const firstUsable = networkAddr + 1;
  const lastUsable = networkAddr + totalHosts - 2;
  const usableHosts = totalHosts - 2;

  const toIp = (n: number) =>
    `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;

  return {
    cidr,
    network: toIp(networkAddr),
    prefix,
    usableHosts: usableHosts.toLocaleString('en-US'),
    firstUsable: toIp(firstUsable),
    lastUsable: toIp(lastUsable),
  };
}

/** Build the two diagram:subnet-* metadata values from a CIDR string. */
export function subnetMeta(cidr: string) {
  const c = parseCidr(cidr);
  return {
    label: `Subnet ${c.cidr}`,
    subtitle: `${c.usableHosts} usable hosts · ${c.firstUsable}–${c.lastUsable}`,
  };
}
