import { Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct, ConstructOrder } from 'constructs';
import {
  Service,
  SubnetGroup,
  ExternalService,
  InternetNode,
  NatGatewayNode,
  Connection,
} from './external';

// ── Helpers ──────────────────────────────────────────────────

function getMeta(c: Construct, key: string): string | undefined {
  const entry = c.node.metadata.find(e => e.type === key);
  return entry?.data as string | undefined;
}

function toNodeId(constructId: string): string {
  return constructId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

const COLOR_SCHEMES: Record<string, {
  main: string; alt: string; nodeFill: string; natFill: string;
}> = {
  BLUE: { main: 'BLUE', alt: 'BLUE_ALT', nodeFill: 'NODE_BLUE_FILL', natFill: 'BLUE_ALT_FILL' },
  GREEN: { main: 'GREEN', alt: 'GREEN_ALT', nodeFill: 'NODE_GREEN_FILL', natFill: 'GREEN_FILL' },
};

// ── DOT Generator ────────────────────────────────────────────

export function generateDot(stack: Stack): string {
  const lines: string[] = [];

  // Collect constructs by type
  const vpcs: ec2.Vpc[] = [];
  const externals: ExternalService[] = [];
  let internetNode: InternetNode | undefined;
  const nats: NatGatewayNode[] = [];
  const securityGroups: ec2.SecurityGroup[] = [];
  // SubnetGroup children of each VPC (vpcId → SubnetGroup[])
  const vpcSubnetGroups = new Map<string, SubnetGroup[]>();
  // Services grouped by their nearest SubnetGroup or VPC (parentId → Service[])
  const groupedServices = new Map<string, Service[]>();
  // All services in a VPC (vpcId → Service[]), used for edge section filtering
  const vpcAllServices = new Map<string, Service[]>();
  // RDS instances grouped by their nearest SubnetGroup or VPC
  const groupedDatabases = new Map<string, rds.DatabaseInstanceBase[]>();
  // All RDS instances in a VPC (for edge filtering)
  const vpcAllDatabases = new Map<string, rds.DatabaseInstanceBase[]>();
  const allConnections: { sourceId: string; conn: Connection }[] = [];

  for (const child of stack.node.findAll(ConstructOrder.PREORDER)) {
    if (child instanceof ec2.Vpc) {
      vpcs.push(child);
    } else if (child instanceof InternetNode) {
      internetNode = child;
    } else if (child instanceof ExternalService) {
      externals.push(child);
    } else if (child instanceof NatGatewayNode) {
      nats.push(child);
    } else if (child instanceof ec2.SecurityGroup) {
      securityGroups.push(child);
    } else if (child instanceof SubnetGroup) {
      // Find parent VPC
      let parent: Construct | undefined = child.node.scope as Construct;
      while (parent && !(parent instanceof ec2.Vpc)) {
        parent = parent.node.scope as Construct | undefined;
      }
      if (parent) {
        const key = parent.node.id;
        if (!vpcSubnetGroups.has(key)) vpcSubnetGroups.set(key, []);
        vpcSubnetGroups.get(key)!.push(child);
      }
    } else if (child instanceof rds.DatabaseInstanceBase) {
      // Find nearest SubnetGroup or VPC ancestor
      let parent: Construct | undefined = child.node.scope as Construct;
      while (parent && !(parent instanceof SubnetGroup) && !(parent instanceof ec2.Vpc)) {
        parent = parent.node.scope as Construct | undefined;
      }
      if (parent) {
        const key = parent.node.id;
        if (!groupedDatabases.has(key)) groupedDatabases.set(key, []);
        groupedDatabases.get(key)!.push(child);
      }
      // Also track by VPC for edge filtering
      let vpc: Construct | undefined = child.node.scope as Construct;
      while (vpc && !(vpc instanceof ec2.Vpc)) {
        vpc = vpc.node.scope as Construct | undefined;
      }
      if (vpc) {
        const vpcKey = vpc.node.id;
        if (!vpcAllDatabases.has(vpcKey)) vpcAllDatabases.set(vpcKey, []);
        vpcAllDatabases.get(vpcKey)!.push(child);
      }
    } else if (child instanceof Service) {
      // Find nearest SubnetGroup or VPC ancestor
      let parent: Construct | undefined = child.node.scope as Construct;
      while (parent && !(parent instanceof SubnetGroup) && !(parent instanceof ec2.Vpc)) {
        parent = parent.node.scope as Construct | undefined;
      }
      if (parent) {
        const key = parent.node.id;
        if (!groupedServices.has(key)) groupedServices.set(key, []);
        groupedServices.get(key)!.push(child);
      }
      // Also track by VPC for edge filtering
      let vpc: Construct | undefined = child.node.scope as Construct;
      while (vpc && !(vpc instanceof ec2.Vpc)) {
        vpc = vpc.node.scope as Construct | undefined;
      }
      if (vpc) {
        const vpcKey = vpc.node.id;
        if (!vpcAllServices.has(vpcKey)) vpcAllServices.set(vpcKey, []);
        vpcAllServices.get(vpcKey)!.push(child);
      }
    }

    // Collect connections
    const connMeta = getMeta(child, 'diagram:connections');
    if (connMeta) {
      for (const conn of JSON.parse(connMeta) as Connection[]) {
        allConnections.push({ sourceId: child.node.id, conn });
      }
    }
  }

  // ── Graph header ───────────────────────────────────────────

  lines.push('digraph NetworkArchitecture {');
  lines.push('    // Global settings');
  lines.push('    graph [');
  lines.push('        rankdir=LR');
  lines.push('        compound=true');
  lines.push('        fontname="Helvetica"');
  lines.push('        fontsize=11');
  lines.push('        bgcolor="BG"');
  lines.push('        color="FG"');
  lines.push('        fontcolor="FG"');
  lines.push('        pad=0.3');
  lines.push('        nodesep=0.4');
  lines.push('        ranksep=0.6');

  // Title label with VPC notes
  const sortedVpcs = [...vpcs].sort((a, b) => {
    const orderA = parseInt(getMeta(a, 'diagram:titleOrder') || '99', 10);
    const orderB = parseInt(getMeta(b, 'diagram:titleOrder') || '99', 10);
    return orderA - orderB;
  });

  lines.push('        label=<');
  lines.push('            <TABLE BORDER="0" CELLSPACING="8" CELLPADDING="4">');
  lines.push('                <TR>');
  lines.push('                    <TD COLSPAN="2" ALIGN="CENTER"><B><FONT POINT-SIZE="14">Network Architecture</FONT></B><BR/>');
  lines.push('                    <FONT POINT-SIZE="9" COLOR="MUTED">VPC layout with firewall, NAT gateway, and internet connectivity</FONT></TD>');
  lines.push('                </TR>');
  lines.push('                <TR>');

  sortedVpcs.forEach((vpc, i) => {
    const titleLabel = getMeta(vpc, 'diagram:titleLabel') || getMeta(vpc, 'diagram:label') || vpc.node.id;
    const note = getMeta(vpc, 'diagram:note') || '';
    const noteLines = note.split('\n').map(l => `${l}<BR ALIGN="LEFT"/>`).join('\n                        ');
    const isFirst = i === 0;
    const borderAttr = isFirst ? ' BORDER="1" COLOR="BORDER" SIDES="R" STYLE="DASHED"' : '';

    lines.push(`                    <TD ALIGN="LEFT" VALIGN="TOP"${borderAttr}>`);
    lines.push(`                        <B><FONT POINT-SIZE="9">${titleLabel}</FONT></B><BR ALIGN="LEFT"/>`);
    lines.push(`                        <FONT POINT-SIZE="8" COLOR="MUTED">${noteLines}</FONT>`);
    lines.push('                    </TD>');
  });

  lines.push('                </TR>');
  lines.push('            </TABLE>');
  lines.push('        >');
  lines.push('        labelloc=t');
  lines.push('    ]');
  lines.push('');

  // ── Node defaults ──────────────────────────────────────────

  lines.push('    node [');
  lines.push('        fontname="Helvetica"');
  lines.push('        fontsize=10');
  lines.push('        style=filled');
  lines.push('        color="BORDER"');
  lines.push('        fontcolor="FG"');
  lines.push('    ]');
  lines.push('');
  lines.push('    edge [');
  lines.push('        fontname="Helvetica"');
  lines.push('        fontsize=8');
  lines.push('        fontcolor="SUBTLE"');
  lines.push('        color="EDGE"');
  lines.push('    ]');

  // ── Internet node ──────────────────────────────────────────

  if (internetNode) {
    lines.push('');
    lines.push('    // ── Internet ──────────────────────────────────────────────');
    lines.push('    internet [');
    lines.push('        label=""');
    lines.push('        image="CLOUD_IMAGE"');
    lines.push('        imagescale=true');
    lines.push('        fixedsize=true');
    lines.push('        width=1.4');
    lines.push('        height=0.9');
    lines.push('        shape=none');
    lines.push('        style=""');
    lines.push('    ]');
  }

  // ── Firewall ───────────────────────────────────────────────

  for (const sg of securityGroups) {
    const label = getMeta(sg, 'diagram:label') || 'Firewall';
    const desc = getMeta(sg, 'diagram:description') || '';
    const rulesJson = getMeta(sg, 'diagram:rules');
    const rules: { cidr: string; label: string }[] = rulesJson ? JSON.parse(rulesJson) : [];
    const nodeId = toNodeId(sg.node.id);

    lines.push('');
    lines.push('    // ── Firewall ──────────────────────────────────────────────');
    lines.push(`    ${nodeId} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="1" CELLPADDING="1">');
    lines.push(`                <TR><TD><B>${label}</B></TD></TR>`);
    if (desc) {
      lines.push(`                <TR><TD><FONT POINT-SIZE="8" COLOR="SUBTLE">${desc}</FONT></TD></TR>`);
    }
    for (const rule of rules) {
      lines.push(`                <TR><TD><FONT POINT-SIZE="7" COLOR="MUTED">${rule.cidr} (${rule.label})</FONT></TD></TR>`);
    }
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        shape=box');
    lines.push('        style="filled,bold"');
    lines.push('        fillcolor="FIREWALL_FILL"');
    lines.push('        color="FIREWALL"');
    lines.push('        fontcolor="FIREWALL"');
    lines.push('    ]');
  }

  // ── NAT Gateways ───────────────────────────────────────────

  lines.push('');
  lines.push('    // ── NAT Gateways ──────────────────────────────────────────');
  for (const nat of nats) {
    const nodeId = toNodeId(nat.node.id);
    const natLabel = getMeta(nat, 'diagram:label') || 'NAT Gateway';
    const ip = getMeta(nat, 'diagram:ip') || '';
    const color = getMeta(nat, 'diagram:color') || 'BLUE';
    const scheme = COLOR_SCHEMES[color] || COLOR_SCHEMES.BLUE;

    lines.push('');
    lines.push(`    ${nodeId} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="1" CELLPADDING="1">');
    lines.push(`                <TR><TD><B>${natLabel}</B></TD></TR>`);
    if (ip) {
      lines.push(`                <TR><TD><FONT POINT-SIZE="8" COLOR="SUBTLE">${ip}</FONT></TD></TR>`);
    }
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        shape=box');
    lines.push('        style="filled,bold"');
    lines.push(`        fillcolor="${scheme.natFill}"`);
    lines.push(`        color="${scheme.main}"`);
    lines.push(`        fontcolor="${scheme.main}"`);
    lines.push('    ]');
  }

  // ── External APIs ──────────────────────────────────────────

  lines.push('');
  lines.push('    // ── External APIs ────────────────────────────────────────');
  for (const ext of externals) {
    const nodeId = toNodeId(ext.node.id);
    const extLabel = getMeta(ext, 'diagram:label') || ext.node.id;
    const desc = getMeta(ext, 'diagram:description') || '';

    lines.push('');
    lines.push(`    ${nodeId} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">');
    lines.push(`                <TR><TD><B>${extLabel}</B></TD></TR>`);
    if (desc) {
      lines.push(`                <TR><TD><FONT POINT-SIZE="7" COLOR="MUTED">${desc}</FONT></TD></TR>`);
    }
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        shape=box');
    lines.push('        style="filled,rounded"');
    lines.push('        fillcolor="BG"');
    lines.push('        color="BORDER"');
    lines.push('    ]');
  }

  // ── VPC clusters ───────────────────────────────────────────

  /** Emit service nodes at the given indent level. */
  function emitServices(services: Service[], scheme: typeof COLOR_SCHEMES['BLUE'], indent: string) {
    for (const svc of services) {
      const svcId = toNodeId(svc.node.id);
      const svcLabel = getMeta(svc, 'diagram:label') || svc.node.id;
      const svcIp = getMeta(svc, 'diagram:ip') || '';
      const svcDesc = getMeta(svc, 'diagram:description') || '';
      const svcShape = getMeta(svc, 'diagram:shape') || 'box';
      const svcStyle = svcShape === 'cylinder' ? 'filled' : 'filled,rounded';

      lines.push('');
      lines.push(`${indent}${svcId} [`);
      lines.push(`${indent}    label=<`);
      lines.push(`${indent}        <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">`);
      lines.push(`${indent}            <TR><TD><B>${svcLabel}</B></TD></TR>`);
      if (svcIp) {
        lines.push(`${indent}            <TR><TD><FONT POINT-SIZE="8" COLOR="SUBTLE">${svcIp}</FONT></TD></TR>`);
      }
      if (svcDesc) {
        lines.push(`${indent}            <TR><TD><FONT POINT-SIZE="7" COLOR="MUTED">${svcDesc}</FONT></TD></TR>`);
      }
      lines.push(`${indent}        </TABLE>`);
      lines.push(`${indent}    >`);
      lines.push(`${indent}    shape=${svcShape}`);
      lines.push(`${indent}    style="${svcStyle}"`);
      lines.push(`${indent}    fillcolor="${scheme.nodeFill}"`);
      lines.push(`${indent}    color="${scheme.main}"`);
      lines.push(`${indent}]`);
    }
  }

  /** Emit RDS database nodes at the given indent level. Always rendered as cylinders. */
  function emitDatabases(databases: rds.DatabaseInstanceBase[], scheme: typeof COLOR_SCHEMES['BLUE'], indent: string) {
    for (const db of databases) {
      const dbId = toNodeId(db.node.id);
      const dbLabel = getMeta(db, 'diagram:label') || db.node.id;
      const dbIp = getMeta(db, 'diagram:ip') || '';
      const dbDesc = getMeta(db, 'diagram:description') || '';

      lines.push('');
      lines.push(`${indent}${dbId} [`);
      lines.push(`${indent}    label=<`);
      lines.push(`${indent}        <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">`);
      lines.push(`${indent}            <TR><TD><B>${dbLabel}</B></TD></TR>`);
      if (dbIp) {
        lines.push(`${indent}            <TR><TD><FONT POINT-SIZE="8" COLOR="SUBTLE">${dbIp}</FONT></TD></TR>`);
      }
      if (dbDesc) {
        lines.push(`${indent}            <TR><TD><FONT POINT-SIZE="7" COLOR="MUTED">${dbDesc}</FONT></TD></TR>`);
      }
      lines.push(`${indent}        </TABLE>`);
      lines.push(`${indent}    >`);
      lines.push(`${indent}    shape=cylinder`);
      lines.push(`${indent}    style="filled"`);
      lines.push(`${indent}    fillcolor="${scheme.nodeFill}"`);
      lines.push(`${indent}    color="${scheme.main}"`);
      lines.push(`${indent}]`);
    }
  }

  /** Emit a subnet subgraph with label, subtitle, service nodes, and database nodes. */
  function emitSubnetCluster(
    clusterId: string, subLabel: string, subSubtitle: string,
    services: Service[], databases: rds.DatabaseInstanceBase[],
    scheme: typeof COLOR_SCHEMES['BLUE'], indent: string,
  ) {
    lines.push(`${indent}subgraph ${clusterId} {`);
    lines.push(`${indent}    label=<`);
    lines.push(`${indent}        <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">`);
    lines.push(`${indent}            <TR><TD><B><FONT COLOR="${scheme.alt}">${subLabel}</FONT></B></TD></TR>`);
    lines.push(`${indent}            <TR><TD><FONT POINT-SIZE="8" COLOR="MUTED">${subSubtitle}</FONT></TD></TR>`);
    lines.push(`${indent}        </TABLE>`);
    lines.push(`${indent}    >`);
    lines.push(`${indent}    style="dashed,filled,rounded"`);
    lines.push(`${indent}    color="${scheme.alt}"`);
    lines.push(`${indent}    fillcolor="SUBNET_FILL"`);
    emitServices(services, scheme, indent + '    ');
    emitDatabases(databases, scheme, indent + '    ');
    lines.push(`${indent}}`);
  }

  // Render VPCs in definition order (VpcA first, then VpcB)
  for (const vpc of vpcs) {
    const vpcId = vpc.node.id;
    const clusterId = `cluster_${toNodeId(vpcId)}`;
    const label = getMeta(vpc, 'diagram:label') || vpcId;
    const subtitle = getMeta(vpc, 'diagram:subtitle') || '';
    const color = getMeta(vpc, 'diagram:color') || 'BLUE';
    const scheme = COLOR_SCHEMES[color] || COLOR_SCHEMES.BLUE;
    const subnetGroups = vpcSubnetGroups.get(vpcId);

    lines.push('');
    lines.push(`    // ── ${label} ──────────────────────────────────────────`);
    lines.push(`    subgraph ${clusterId} {`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">');
    lines.push(`                <TR><TD><B><FONT COLOR="${scheme.main}">${label}</FONT></B></TD></TR>`);
    lines.push(`                <TR><TD><FONT POINT-SIZE="9" COLOR="MUTED">${subtitle}</FONT></TD></TR>`);
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        style="dashed,filled,rounded"');
    lines.push(`        color="${scheme.main}"`);
    lines.push('        fillcolor="CLUSTER_FILL"');
    lines.push(`        fontcolor="${scheme.main}"`);

    // Invisible anchor node for compound edges (VPC → NAT)
    const anchorId = `_anchor_${toNodeId(vpcId).replace('vpc_', '')}`;
    lines.push('');
    lines.push(`        ${anchorId} [shape=point, style=invis, width=0]`);
    lines.push('');

    if (subnetGroups && subnetGroups.length > 0) {
      // VPC-level services (not inside any SubnetGroup — e.g. ELB, Multi-AZ DB)
      const vpcLevelServices = groupedServices.get(vpcId) || [];
      emitServices(vpcLevelServices, scheme, '        ');
      const vpcLevelDatabases = groupedDatabases.get(vpcId) || [];
      emitDatabases(vpcLevelDatabases, scheme, '        ');

      // Subnet clusters (one per SubnetGroup / AZ)
      for (const sg of subnetGroups) {
        const sgLabel = getMeta(sg, 'diagram:label') || sg.node.id;
        const sgSubtitle = getMeta(sg, 'diagram:subtitle') || '';
        const sgClusterId = `cluster_${toNodeId(sg.node.id)}`;
        const services = groupedServices.get(sg.node.id) || [];
        const databases = groupedDatabases.get(sg.node.id) || [];
        emitSubnetCluster(sgClusterId, sgLabel, sgSubtitle, services, databases, scheme, '        ');
        lines.push('');
      }
    } else {
      // Single subnet cluster from VPC metadata
      const subnetLabel = getMeta(vpc, 'diagram:subnet-label') || '';
      const subnetSubtitle = getMeta(vpc, 'diagram:subnet-subtitle') || '';
      const subnetClusterId = `cluster_subnet_${toNodeId(vpcId).replace('vpc_', '')}`;
      const services = groupedServices.get(vpcId) || [];
      const databases = groupedDatabases.get(vpcId) || [];
      emitSubnetCluster(subnetClusterId, subnetLabel, subnetSubtitle, services, databases, scheme, '        ');
    }

    lines.push('    }');
  }

  // ── Edges ──────────────────────────────────────────────────

  // Build a map of VPC construct IDs → anchor node IDs and cluster names
  const vpcAnchorNode = new Map<string, string>();
  const vpcClusterName = new Map<string, string>();
  for (const vpc of vpcs) {
    const vpcId = vpc.node.id;
    const suffix = toNodeId(vpcId).replace('vpc_', '');
    vpcAnchorNode.set(vpcId, `_anchor_${suffix}`);
    vpcClusterName.set(vpcId, `cluster_${toNodeId(vpcId)}`);
  }

  // Organize connections by source
  const connBySource = new Map<string, Connection[]>();
  for (const { sourceId, conn } of allConnections) {
    if (!connBySource.has(sourceId)) connBySource.set(sourceId, []);
    connBySource.get(sourceId)!.push(conn);
  }

  // For VPC-sourced connections, rewrite to use anchor node + ltail on VPC cluster
  for (const vpc of vpcs) {
    const vpcId = vpc.node.id;
    const conns = connBySource.get(vpcId);
    if (!conns) continue;
    const anchor = vpcAnchorNode.get(vpcId)!;
    const cluster = vpcClusterName.get(vpcId)!;
    connBySource.delete(vpcId);
    const rewritten = conns.map(c => ({ ...c, ltail: cluster }));
    connBySource.set(anchor, rewritten);
  }

  // Collect all edges in a flat list preserving source order
  const allEdges: { src: string; conn: Connection }[] = [];
  for (const [sourceId, conns] of connBySource) {
    for (const conn of conns) {
      allEdges.push({ src: sourceId, conn });
    }
  }

  // Emit edges grouped by section
  const edgeOrder: { comment: string; filter: (e: { src: string; conn: Connection }) => boolean }[] = [
    {
      comment: 'Edges: Internet → Firewall → VPC-A',
      filter: e => (e.src === 'Internet' && e.conn.target === 'Firewall') ||
                   e.src === 'Firewall',
    },
    {
      comment: 'Edges: Subnet → NAT → Internet → External APIs',
      filter: e => (e.src.startsWith('_anchor_')) ||
                   (e.src === 'NatA' || e.src === 'NatB') ||
                   (e.src === 'Internet' && e.conn.target !== 'Firewall'),
    },
    {
      comment: 'Edges: Internal VPC-A flows',
      filter: e => {
        const ids = new Set([
          ...(vpcAllServices.get('VpcA') || []).map(s => s.node.id),
          ...(vpcAllDatabases.get('VpcA') || []).map(d => d.node.id),
        ]);
        return ids.has(e.src);
      },
    },
    {
      comment: 'Edges: Internal VPC-B flows',
      filter: e => {
        const ids = new Set([
          ...(vpcAllServices.get('VpcB') || []).map(s => s.node.id),
          ...(vpcAllDatabases.get('VpcB') || []).map(d => d.node.id),
        ]);
        return ids.has(e.src);
      },
    },
  ];

  const emitted = new Set<number>();
  for (const section of edgeOrder) {
    const sectionEdges: { src: string; conn: Connection }[] = [];
    allEdges.forEach((e, i) => {
      if (!emitted.has(i) && section.filter(e)) {
        sectionEdges.push(e);
        emitted.add(i);
      }
    });
    if (sectionEdges.length === 0) continue;
    lines.push('');
    lines.push(`    // ── ${section.comment} ────────────────────`);
    for (const { src, conn } of sectionEdges) {
      const srcId = toNodeId(src);
      const tgtId = toNodeId(conn.target);
      const attrs: string[] = [];

      if (conn.htmlLabel !== undefined) {
        attrs.push(`label=<${conn.htmlLabel}>`);
      } else if (conn.label !== undefined) {
        attrs.push(`label="${conn.label}"`);
      }

      if (conn.style) attrs.push(`style=${conn.style}`);
      if (conn.color) attrs.push(`color="${conn.color}"`);
      if (conn.fontcolor) attrs.push(`fontcolor="${conn.fontcolor}"`);
      if (conn.ltail) attrs.push(`ltail=${conn.ltail}`);

      lines.push(`    ${srcId} -> ${tgtId} [`);
      for (const attr of attrs) {
        lines.push(`        ${attr}`);
      }
      lines.push('    ]');
    }
  }

  lines.push('');
  lines.push('}');

  return lines.join('\n') + '\n';
}
