import { Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct, ConstructOrder } from 'constructs';
import { getMeta, toNodeId } from './dot-helpers';
import { ServerFleet } from './compute';
import { Connection } from './external';

// ── EC2 Diagram Generator ────────────────────────────────────
// Focused view of EC2 instances: instance type, count, security
// groups, VPC/subnet placement, and inter-fleet connections.

interface FleetInfo {
  construct: ServerFleet;
  id: string;
  label: string;
  ip: string;
  description: string;
  instanceType: string;
  count: string;
  vpcLabel: string;
  subnetLabel: string;
  securityGroups: string[];
}

function extractFleetInfo(fleet: ServerFleet): FleetInfo {
  const id = fleet.node.id;
  const label = getMeta(fleet, 'diagram:label') || id;
  const ip = getMeta(fleet, 'diagram:ip') || '';
  const description = getMeta(fleet, 'diagram:description') || '';
  const instanceType = getMeta(fleet, 'diagram:instanceType') || 'Unknown';
  const count = getMeta(fleet, 'diagram:count') || '1';

  let vpcLabel = '';
  let subnetLabel = '';
  const securityGroups: string[] = [];

  // Find parent VPC and subnet
  let parent: Construct | undefined = fleet.node.scope as Construct;
  while (parent) {
    if (!subnetLabel && getMeta(parent, 'diagram:label') && !(parent instanceof ec2.Vpc)) {
      subnetLabel = getMeta(parent, 'diagram:label') || '';
    }
    if (parent instanceof ec2.Vpc) {
      vpcLabel = getMeta(parent, 'diagram:label') || parent.node.id;
      break;
    }
    parent = parent.node.scope as Construct | undefined;
  }

  // Collect security groups from child instances
  for (const child of fleet.node.findAll(ConstructOrder.PREORDER)) {
    if (child instanceof ec2.SecurityGroup) {
      securityGroups.push(child.securityGroupId);
    }
  }

  return { construct: fleet, id, label, ip, description, instanceType, count, vpcLabel, subnetLabel, securityGroups };
}

export function generateEc2Dot(stack: Stack): string {
  const lines: string[] = [];
  const fleets: FleetInfo[] = [];
  const allConnections: { sourceId: string; conn: Connection }[] = [];

  // Collect ServerFleets and connections
  for (const child of stack.node.findAll(ConstructOrder.PREORDER)) {
    if (child instanceof ServerFleet) {
      fleets.push(extractFleetInfo(child));
    }

    const connMeta = getMeta(child, 'diagram:connections');
    if (connMeta) {
      for (const conn of JSON.parse(connMeta) as Connection[]) {
        allConnections.push({ sourceId: child.node.id, conn });
      }
    }
  }

  // Filter connections to those involving fleet nodes
  const fleetIds = new Set(fleets.map(f => f.id));
  const fleetConnections = allConnections.filter(
    c => fleetIds.has(c.sourceId) || fleetIds.has(c.conn.target),
  );

  // ── Graph header ───────────────────────────────────────────

  lines.push('digraph EC2Architecture {');
  lines.push('    graph [');
  lines.push('        rankdir=TB');
  lines.push('        fontname="Helvetica"');
  lines.push('        fontsize=11');
  lines.push('        bgcolor="BG"');
  lines.push('        color="FG"');
  lines.push('        fontcolor="FG"');
  lines.push('        pad=0.5');
  lines.push('        nodesep=0.6');
  lines.push('        ranksep=0.8');
  lines.push('        label=<');
  lines.push('            <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="4">');
  lines.push('                <TR><TD><B><FONT POINT-SIZE="14">EC2 Compute Architecture</FONT></B></TD></TR>');
  lines.push('                <TR><TD><FONT POINT-SIZE="9" COLOR="MUTED">Instance fleets, types, placement, and connectivity</FONT></TD></TR>');
  lines.push('            </TABLE>');
  lines.push('        >');
  lines.push('        labelloc=t');
  lines.push('    ]');
  lines.push('');
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

  // ── Fleet nodes ────────────────────────────────────────────

  for (const fleet of fleets) {
    const nodeId = toNodeId(fleet.id);

    lines.push('');
    lines.push(`    ${nodeId} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="2" CELLPADDING="2">');
    lines.push(`                <TR><TD COLSPAN="2"><B><FONT POINT-SIZE="11">${fleet.label}</FONT></B></TD></TR>`);
    if (fleet.ip) {
      lines.push(`                <TR><TD COLSPAN="2"><FONT POINT-SIZE="8" COLOR="SUBTLE">${fleet.ip}</FONT></TD></TR>`);
    }
    if (fleet.description) {
      lines.push(`                <TR><TD COLSPAN="2"><FONT POINT-SIZE="7" COLOR="MUTED">${fleet.description}</FONT></TD></TR>`);
    }
    lines.push('                <HR/>');
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Instance Type</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${fleet.instanceType}</FONT></TD></TR>`);
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Count</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${fleet.count}</FONT></TD></TR>`);
    if (fleet.vpcLabel) {
      lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">VPC</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${fleet.vpcLabel}</FONT></TD></TR>`);
    }
    if (fleet.subnetLabel) {
      lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Subnet</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${fleet.subnetLabel}</FONT></TD></TR>`);
    }
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        shape=box');
    lines.push('        style="filled,rounded"');
    lines.push('        fillcolor="NODE_BLUE_FILL"');
    lines.push('        color="BLUE"');
    lines.push('    ]');
  }

  // ── Edges ──────────────────────────────────────────────────

  if (fleetConnections.length > 0) {
    lines.push('');
    lines.push('    // ── Fleet Connections ────────────────────────────');
    for (const { sourceId, conn } of fleetConnections) {
      const srcId = toNodeId(sourceId);
      const tgtId = toNodeId(conn.target);
      const attrs: string[] = [];

      if (conn.label) attrs.push(`label="${conn.label}"`);
      if (conn.style) attrs.push(`style=${conn.style}`);
      if (conn.color) attrs.push(`color="${conn.color}"`);
      if (conn.fontcolor) attrs.push(`fontcolor="${conn.fontcolor}"`);

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
