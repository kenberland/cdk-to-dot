import { Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct, ConstructOrder } from 'constructs';
import { getMeta, toNodeId } from './dot-helpers';
import { CacheNode } from './cache';
import { Connection } from './external';

// ── ElastiCache Diagram Generator ────────────────────────────
// Focused view of ElastiCache clusters: engine, node type, count,
// VPC/subnet placement.

interface CacheInfo {
  construct: CacheNode;
  id: string;
  label: string;
  ip: string;
  description: string;
  engine: string;
  engineVersion: string;
  nodeType: string;
  numNodes: string;
  vpcLabel: string;
  subnetLabel: string;
}

function extractCacheInfo(cache: CacheNode): CacheInfo {
  const id = cache.node.id;
  const label = getMeta(cache, 'diagram:label') || id;
  const ip = getMeta(cache, 'diagram:ip') || '';
  const description = getMeta(cache, 'diagram:description') || '';
  const engine = getMeta(cache, 'diagram:engine') || 'valkey';
  const engineVersion = getMeta(cache, 'diagram:engineVersion') || '';
  const nodeType = getMeta(cache, 'diagram:cacheNodeType') || 'Unknown';
  const numNodes = getMeta(cache, 'diagram:numCacheNodes') || '1';

  let vpcLabel = '';
  let subnetLabel = '';

  let parent: Construct | undefined = cache.node.scope as Construct;
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

  return { construct: cache, id, label, ip, description, engine, engineVersion, nodeType, numNodes, vpcLabel, subnetLabel };
}

export function generateElastiCacheDot(stack: Stack): string {
  const lines: string[] = [];
  const caches: CacheInfo[] = [];
  const allConnections: { sourceId: string; conn: Connection }[] = [];

  for (const child of stack.node.findAll(ConstructOrder.PREORDER)) {
    if (child instanceof CacheNode) {
      caches.push(extractCacheInfo(child));
    }

    const connMeta = getMeta(child, 'diagram:connections');
    if (connMeta) {
      for (const conn of JSON.parse(connMeta) as Connection[]) {
        allConnections.push({ sourceId: child.node.id, conn });
      }
    }
  }

  const cacheIds = new Set(caches.map(c => c.id));
  const cacheConnections = allConnections.filter(
    c => cacheIds.has(c.sourceId) || cacheIds.has(c.conn.target),
  );

  // ── Graph header ───────────────────────────────────────────

  lines.push('digraph ElastiCacheArchitecture {');
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
  lines.push('                <TR><TD><B><FONT POINT-SIZE="14">ElastiCache Architecture</FONT></B></TD></TR>');
  lines.push('                <TR><TD><FONT POINT-SIZE="9" COLOR="MUTED">Cache clusters, engine configuration, and placement</FONT></TD></TR>');
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

  // ── Cache nodes ────────────────────────────────────────────

  for (const cache of caches) {
    const nodeId = toNodeId(cache.id);

    lines.push('');
    lines.push(`    ${nodeId} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="2" CELLPADDING="2">');
    lines.push(`                <TR><TD COLSPAN="2"><B><FONT POINT-SIZE="11">${cache.label}</FONT></B></TD></TR>`);
    if (cache.ip) {
      lines.push(`                <TR><TD COLSPAN="2"><FONT POINT-SIZE="8" COLOR="SUBTLE">${cache.ip}</FONT></TD></TR>`);
    }
    if (cache.description) {
      lines.push(`                <TR><TD COLSPAN="2"><FONT POINT-SIZE="7" COLOR="MUTED">${cache.description}</FONT></TD></TR>`);
    }
    lines.push('                <HR/>');
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Engine</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${cache.engine} ${cache.engineVersion}</FONT></TD></TR>`);
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Node Type</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${cache.nodeType}</FONT></TD></TR>`);
    lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Nodes</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${cache.numNodes}</FONT></TD></TR>`);
    if (cache.vpcLabel) {
      lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">VPC</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${cache.vpcLabel}</FONT></TD></TR>`);
    }
    if (cache.subnetLabel) {
      lines.push(`                <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="MUTED">Subnet</FONT></TD><TD ALIGN="LEFT"><FONT POINT-SIZE="8">${cache.subnetLabel}</FONT></TD></TR>`);
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

  if (cacheConnections.length > 0) {
    lines.push('');
    lines.push('    // ── Cache Connections ────────────────────────────');
    for (const { sourceId, conn } of cacheConnections) {
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
