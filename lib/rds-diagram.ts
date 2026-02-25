import { Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct, ConstructOrder } from 'constructs';
import { getMeta, toNodeId, COLOR_SCHEMES } from './dot-helpers';
import { Connection } from './external';

// ── RDS Diagram Generator ────────────────────────────────────
// Focused view of RDS instances: engine, instance type, storage,
// security groups, subnet groups, and replication topology.

interface DbInfo {
  instance: rds.DatabaseInstanceBase;
  id: string;
  label: string;
  engine: string;
  instanceType: string;
  storage: string;
  multiAz: string;
  vpcId: string;
  subnets: string;
  securityGroups: string[];
}

function extractDbInfo(db: rds.DatabaseInstanceBase): DbInfo {
  const id = db.node.id;
  const label = getMeta(db, 'diagram:label') || id;
  const ip = getMeta(db, 'diagram:ip') || '';
  const desc = getMeta(db, 'diagram:description') || '';

  // Extract engine info from the construct tree
  let engine = desc || 'Unknown';
  let instanceType = 'Unknown';
  let storage = '';
  let multiAz = 'No';
  let vpcId = '';
  let subnets = '';
  const securityGroups: string[] = [];

  // Walk the CFN resource for details
  for (const child of db.node.findAll(ConstructOrder.PREORDER)) {
    if (child.constructor.name === 'CfnDBInstance') {
      const cfn = child as any;
      if (cfn.engine) engine = String(cfn.engine);
      if (cfn.dbInstanceClass) instanceType = String(cfn.dbInstanceClass).replace('db.', '');
      if (cfn.allocatedStorage) storage = `${cfn.allocatedStorage} GB`;
      if (cfn.multiAz) multiAz = 'Yes';
    }
    if (child instanceof ec2.SecurityGroup) {
      securityGroups.push(child.securityGroupId);
    }
  }

  // Find parent VPC
  let parent: Construct | undefined = db.node.scope as Construct;
  while (parent && !(parent instanceof ec2.Vpc)) {
    parent = parent.node.scope as Construct | undefined;
  }
  if (parent) {
    vpcId = getMeta(parent, 'diagram:label') || parent.node.id;
  }

  return { instance: db, id, label, engine, instanceType, storage, multiAz, vpcId, subnets, securityGroups };
}

export function generateRdsDot(stack: Stack): string {
  const lines: string[] = [];
  const databases: DbInfo[] = [];
  const allConnections: { sourceId: string; conn: Connection }[] = [];

  // Collect RDS instances and connections
  for (const child of stack.node.findAll(ConstructOrder.PREORDER)) {
    if (child instanceof rds.DatabaseInstanceBase) {
      databases.push(extractDbInfo(child));
    }

    const connMeta = getMeta(child, 'diagram:connections');
    if (connMeta) {
      for (const conn of JSON.parse(connMeta) as Connection[]) {
        allConnections.push({ sourceId: child.node.id, conn });
      }
    }
  }

  // Filter connections to only those involving database nodes
  const dbIds = new Set(databases.map(d => d.id));
  const dbConnections = allConnections.filter(
    c => dbIds.has(c.sourceId) || dbIds.has(c.conn.target),
  );

  // ── Graph header ───────────────────────────────────────────

  lines.push('digraph RDSArchitecture {');
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
  lines.push('                <TR><TD><B><FONT POINT-SIZE="14">RDS Database Architecture</FONT></B></TD></TR>');
  lines.push('                <TR><TD><FONT POINT-SIZE="9" COLOR="MUTED">Instance configuration, replication, and network placement</FONT></TD></TR>');
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

  // ── Database nodes ─────────────────────────────────────────

  for (const db of databases) {
    const nodeId = toNodeId(db.id);
    const ip = getMeta(db.instance, 'diagram:ip') || '';

    lines.push('');
    lines.push(`    ${nodeId} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="2" CELLPADDING="2">');
    lines.push(`                <TR><TD COLSPAN="2"><B><FONT POINT-SIZE="11">${db.label}</FONT></B></TD></TR>`);
    if (ip) {
      lines.push(`                <TR><TD COLSPAN="2"><FONT POINT-SIZE="8" COLOR="SUBTLE">${ip}</FONT></TD></TR>`);
    }
    lines.push('                <HR/>');
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Engine</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${db.engine}</FONT></TD></TR>`);
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Instance</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${db.instanceType}</FONT></TD></TR>`);
    if (db.storage) {
      lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Storage</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${db.storage}</FONT></TD></TR>`);
    }
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Multi-AZ</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${db.multiAz}</FONT></TD></TR>`);
    if (db.vpcId) {
      lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">VPC</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${db.vpcId}</FONT></TD></TR>`);
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

  if (dbConnections.length > 0) {
    lines.push('');
    lines.push('    // ── Replication / Connections ────────────────────');
    for (const { sourceId, conn } of dbConnections) {
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
