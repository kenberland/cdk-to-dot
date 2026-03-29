import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  path: string;
  constructInfo?: { fqn: string };
  children?: Record<string, TreeNode>;
  attributes?: Record<string, unknown>;
}

interface CfTemplate {
  Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
  Outputs?: Record<string, { Value: unknown; Export?: { Name: unknown } }>;
}

interface DiagramNode {
  id: string;          // DOT node id
  label: string;
  subtitle?: string;
  shape?: string;
  color?: string;      // COLOR_SCHEMES key
  isExternal?: boolean;
  isNat?: boolean;
  isInternet?: boolean;
}

interface DiagramEdge {
  src: string;
  dst: string;
  label?: string;
  style?: string;
  color?: string;
  fontcolor?: string;
}

interface SubnetCluster {
  id: string;
  label: string;
  subtitle: string;
  nodes: DiagramNode[];
}

interface VpcCluster {
  id: string;
  label: string;
  subtitle: string;
  color: string;
  vpcLevelNodes: DiagramNode[];
  subnets: SubnetCluster[];
}

// ── Helpers ───────────────────────────────────────────────────

function toNodeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

/** Walk a tree node, yielding every descendant that matches predicate. */
function findAll(node: TreeNode, predicate: (n: TreeNode) => boolean): TreeNode[] {
  const results: TreeNode[] = [];
  function walk(n: TreeNode) {
    if (predicate(n)) results.push(n);
    for (const child of Object.values(n.children ?? {})) walk(child);
  }
  walk(node);
  return results;
}

/** Find direct child by id (case-insensitive). */
function findChild(node: TreeNode, id: string): TreeNode | undefined {
  return Object.values(node.children ?? {}).find(c => c.id === id);
}

/** Return the FQN of a node. */
function fqn(node: TreeNode): string {
  return node.constructInfo?.fqn ?? '';
}

// ── Main generator ────────────────────────────────────────────

export function generateCfDot(cdkOutDir: string): string {
  // Load tree.json
  const treeJson = JSON.parse(
    fs.readFileSync(path.join(cdkOutDir, 'tree.json'), 'utf8'),
  ) as { tree: TreeNode };
  const appNode = treeJson.tree;

  // Load all stack templates, keyed by stack name
  const templates = new Map<string, CfTemplate>();
  for (const entry of fs.readdirSync(cdkOutDir)) {
    if (entry.endsWith('.template.json')) {
      const stackName = entry.replace('.template.json', '');
      templates.set(
        stackName,
        JSON.parse(fs.readFileSync(path.join(cdkOutDir, entry), 'utf8')) as CfTemplate,
      );
    }
  }

  // ── Collect top-level stacks ──────────────────────────────

  const stacks = Object.values(appNode.children ?? {}).filter(
    n => fqn(n).endsWith('.Stack'),
  );

  // ── Build diagram model ───────────────────────────────────

  const vpcs: VpcCluster[] = [];
  const externalNodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let hasInternet = false;
  const natNodes: DiagramNode[] = [];

  // Fixed external nodes we always show
  hasInternet = true;

  for (const stack of stacks) {
    const stackName = stack.id;

    // ── VPC (CmdrInfraStack) ────────────────────────────────
    const vpcNode = findChild(stack, 'Vpc');
    if (vpcNode && fqn(vpcNode).includes('aws_ec2.Vpc')) {
      const publicSubnet1 = findChild(vpcNode, 'PublicSubnet1');
      const publicSubnet2 = findChild(vpcNode, 'PublicSubnet2');
      const privateSubnet1 = findChild(vpcNode, 'PrivateSubnet1');
      const privateSubnet2 = findChild(vpcNode, 'PrivateSubnet2');

      // NAT gateway is in PublicSubnet1
      if (publicSubnet1) {
        natNodes.push({
          id: 'nat_gateway',
          label: 'NAT Gateway',
          subtitle: 'Public Subnet 1',
          isNat: true,
          color: 'BLUE',
        });
      }

      const vpc: VpcCluster = {
        id: 'vpc_cmdr',
        label: 'cmdr VPC',
        subtitle: 'us-east-1 · 2 AZs',
        color: 'BLUE',
        vpcLevelNodes: [],
        subnets: [],
      };

      // ALB (VPC-level, spans AZs)
      const albNode = findChild(stack, 'Alb');
      if (albNode) {
        vpc.vpcLevelNodes.push({
          id: 'alb',
          label: 'ALB',
          subtitle: 'Application Load Balancer',
          color: 'BLUE',
        });
      }

      // ECS Cluster
      const clusterNode = findChild(stack, 'Cluster');
      if (clusterNode) {
        vpc.vpcLevelNodes.push({
          id: 'ecs_cluster',
          label: 'ECS Cluster',
          subtitle: 'Fargate',
          color: 'BLUE',
        });
      }

      // Private subnets — Fargate tasks
      if (privateSubnet1 || privateSubnet2) {
        const fargateNodes: DiagramNode[] = [];

        // cmdr app
        const fargateNode = findChild(stack, 'FargateService');
        if (fargateNode) {
          fargateNodes.push({
            id: 'fargate_app',
            label: 'cmdr app',
            subtitle: 'Fargate task · Flask/gunicorn',
            color: 'BLUE',
          });
        }

        // code-api
        const codeApiStack = stacks.find(s => s.id === 'CmdrCodeApiStack');
        if (codeApiStack) {
          const svc = findChild(codeApiStack, 'Service');
          if (svc) {
            fargateNodes.push({
              id: 'code_api',
              label: 'code-api',
              subtitle: 'Fargate task · nsjail sandbox',
              color: 'BLUE',
            });
          }
        }

        // Redis (ECS sidecar)
        const redisStack = stacks.find(s => s.id === 'CmdrRedisStack');
        if (redisStack) {
          const svc = findChild(redisStack, 'Service');
          if (svc) {
            fargateNodes.push({
              id: 'redis',
              label: 'Redis',
              subtitle: 'Fargate task · EFS-backed',
              shape: 'cylinder',
              color: 'BLUE',
            });
          }
        }

        vpc.subnets.push({
          id: 'cluster_private_subnets',
          label: 'Private Subnets (1a, 1b)',
          subtitle: 'Fargate tasks',
          nodes: fargateNodes,
        });
      }

      // Public subnets — ALB lives here (shown at VPC level, subnets for NAT)
      if (publicSubnet1 || publicSubnet2) {
        vpc.subnets.push({
          id: 'cluster_public_subnets',
          label: 'Public Subnets (1a, 1b)',
          subtitle: 'ALB · NAT Gateway',
          nodes: [],  // ALB already at VPC level, NAT rendered separately
        });
      }

      vpcs.push(vpc);
    }

    // ── ECR (CmdrEcrStack) ──────────────────────────────────
    if (stackName === 'CmdrEcrStack') {
      externalNodes.push({
        id: 'ecr',
        label: 'ECR',
        subtitle: 'cmdr-app · code-api',
      });
    }

    // ── S3 + CloudFront (CmdrAssetsBucketStack) ─────────────
    if (stackName === 'CmdrAssetsBucketStack') {
      externalNodes.push({
        id: 's3_assets',
        label: 'S3',
        subtitle: 'Static assets · CSS/JS',
      });
      externalNodes.push({
        id: 'cloudfront',
        label: 'CloudFront',
        subtitle: 'CDN · assets.cmdr.sh',
      });
    }

    // ── Route53 (CmdrDnsStack) ──────────────────────────────
    if (stackName === 'CmdrDnsStack') {
      externalNodes.push({
        id: 'route53',
        label: 'Route 53',
        subtitle: 'cmdr.sh hosted zone',
      });
    }

    // ── GitLab CI/CD (CmdrCiUserStack) ──────────────────────
    if (stackName === 'CmdrCiUserStack') {
      externalNodes.push({
        id: 'gitlab_ci',
        label: 'GitLab CI',
        subtitle: 'OIDC · deploy role',
      });
    }
  }

  // ── Edges ─────────────────────────────────────────────────

  // Internet → Route53 → ALB
  edges.push({ src: 'internet', dst: 'route53', label: 'DNS lookup', style: 'dashed', color: 'EDGE' });
  edges.push({ src: 'internet', dst: 'alb', label: 'HTTPS :443', color: 'EDGE' });

  // Route53 → CloudFront (assets subdomain)
  edges.push({ src: 'route53', dst: 'cloudfront', label: 'assets.cmdr.sh', style: 'dashed', color: 'EDGE' });

  // CloudFront → S3
  edges.push({ src: 'cloudfront', dst: 's3_assets', label: 'origin fetch', color: 'EDGE' });

  // ALB → Fargate services
  edges.push({ src: 'alb', dst: 'fargate_app', label: 'HTTP', color: 'BLUE', fontcolor: 'BLUE' });
  edges.push({ src: 'alb', dst: 'code_api', label: '/api/code', color: 'BLUE', fontcolor: 'BLUE' });

  // Fargate app → external services (egress via NAT)
  edges.push({ src: 'fargate_app', dst: 's3_assets', label: 'upload assets', style: 'dashed', color: 'EDGE' });
  edges.push({ src: 'fargate_app', dst: 'ecr', label: 'pull image', style: 'dashed', color: 'EDGE' });
  edges.push({ src: 'fargate_app', dst: 'nat_gateway', label: 'egress', style: 'dashed', color: 'BLUE', fontcolor: 'BLUE' });

  // code-api → Redis
  edges.push({ src: 'code_api', dst: 'redis', label: 'cache', color: 'BLUE', fontcolor: 'BLUE' });
  edges.push({ src: 'code_api', dst: 'nat_gateway', label: 'egress', style: 'dashed', color: 'BLUE', fontcolor: 'BLUE' });

  // NAT → Internet
  edges.push({ src: 'nat_gateway', dst: 'internet', label: 'egress only', style: 'dashed', color: 'BLUE', fontcolor: 'BLUE' });

  // GitLab CI → ECR, S3, ECS
  edges.push({ src: 'gitlab_ci', dst: 'ecr', label: 'docker push', color: 'EDGE' });
  edges.push({ src: 'gitlab_ci', dst: 's3_assets', label: 'upload', color: 'EDGE' });
  edges.push({ src: 'gitlab_ci', dst: 'fargate_app', label: 'force deploy', style: 'dashed', color: 'EDGE' });

  // ── Emit DOT ──────────────────────────────────────────────

  const lines: string[] = [];

  lines.push('digraph CmdrArchitecture {');
  lines.push('    // Global settings');
  lines.push('    graph [');
  lines.push('        rankdir=LR');
  lines.push('        compound=true');
  lines.push('        fontname="Helvetica"');
  lines.push('        fontsize=11');
  lines.push('        bgcolor="BG"');
  lines.push('        color="FG"');
  lines.push('        fontcolor="FG"');
  lines.push('        pad=0.4');
  lines.push('        nodesep=0.5');
  lines.push('        ranksep=0.8');
  lines.push('        label=<');
  lines.push('            <TABLE BORDER="0" CELLSPACING="8" CELLPADDING="4">');
  lines.push('                <TR><TD ALIGN="CENTER">');
  lines.push('                    <B><FONT POINT-SIZE="14">cmdr Infrastructure</FONT></B><BR/>');
  lines.push('                    <FONT POINT-SIZE="9" COLOR="MUTED">Generated from cdk.out · AWS · us-east-1</FONT>');
  lines.push('                </TD></TR>');
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
  lines.push('        fillcolor="BG"');
  lines.push('    ]');
  lines.push('');
  lines.push('    edge [');
  lines.push('        fontname="Helvetica"');
  lines.push('        fontsize=8');
  lines.push('        fontcolor="SUBTLE"');
  lines.push('        color="EDGE"');
  lines.push('    ]');

  // Internet node
  if (hasInternet) {
    lines.push('');
    lines.push('    // ── Internet ───────────────────────────────────');
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

  // NAT nodes (outside VPC cluster, so DOT edge to VPC makes sense)
  for (const nat of natNodes) {
    lines.push('');
    lines.push(`    // ── ${nat.label} ───────────────────────────────`);
    lines.push(`    ${nat.id} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="1" CELLPADDING="2">');
    lines.push(`                <TR><TD><B>${nat.label}</B></TD></TR>`);
    if (nat.subtitle) {
      lines.push(`                <TR><TD><FONT POINT-SIZE="8" COLOR="MUTED">${nat.subtitle}</FONT></TD></TR>`);
    }
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        shape=box');
    lines.push('        style="filled,bold"');
    lines.push('        fillcolor="BLUE_ALT_FILL"');
    lines.push('        color="BLUE"');
    lines.push('        fontcolor="BLUE"');
    lines.push('    ]');
  }

  // External nodes
  lines.push('');
  lines.push('    // ── External services ────────────────────────────');
  for (const ext of externalNodes) {
    lines.push('');
    lines.push(`    ${toNodeId(ext.id)} [`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="2">');
    lines.push(`                <TR><TD><B>${ext.label}</B></TD></TR>`);
    if (ext.subtitle) {
      lines.push(`                <TR><TD><FONT POINT-SIZE="8" COLOR="MUTED">${ext.subtitle}</FONT></TD></TR>`);
    }
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        shape=box');
    lines.push('        style="filled,rounded"');
    lines.push('        fillcolor="BG"');
    lines.push('        color="BORDER"');
    lines.push('    ]');
  }

  // VPC clusters
  for (const vpc of vpcs) {
    const schemeMain = `${vpc.color}`;
    const schemeAlt = `${vpc.color}_ALT`;
    const schemeFill = `NODE_${vpc.color}_FILL`;

    lines.push('');
    lines.push(`    // ── ${vpc.label} ──────────────────────────────────`);
    lines.push(`    subgraph cluster_${vpc.id} {`);
    lines.push('        label=<');
    lines.push('            <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">');
    lines.push(`                <TR><TD><B><FONT COLOR="${schemeMain}">${vpc.label}</FONT></B></TD></TR>`);
    lines.push(`                <TR><TD><FONT POINT-SIZE="9" COLOR="MUTED">${vpc.subtitle}</FONT></TD></TR>`);
    lines.push('            </TABLE>');
    lines.push('        >');
    lines.push('        style="dashed,filled,rounded"');
    lines.push(`        color="${schemeMain}"`);
    lines.push('        fillcolor="CLUSTER_FILL"');
    lines.push(`        fontcolor="${schemeMain}"`);
    lines.push('');
    // Invisible anchor for compound edges
    lines.push(`        _anchor_${vpc.id} [shape=point style=invis width=0]`);

    // VPC-level nodes
    for (const node of vpc.vpcLevelNodes) {
      lines.push('');
      emitServiceNode(lines, node, schemeFill, schemeMain, '        ');
    }

    // Subnet clusters
    for (const subnet of vpc.subnets) {
      lines.push('');
      lines.push(`        subgraph ${subnet.id} {`);
      lines.push('            label=<');
      lines.push('                <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1">');
      lines.push(`                    <TR><TD><B><FONT COLOR="${schemeAlt}">${subnet.label}</FONT></B></TD></TR>`);
      lines.push(`                    <TR><TD><FONT POINT-SIZE="8" COLOR="MUTED">${subnet.subtitle}</FONT></TD></TR>`);
      lines.push('                </TABLE>');
      lines.push('            >');
      lines.push('            style="dashed,filled,rounded"');
      lines.push(`            color="${schemeAlt}"`);
      lines.push('            fillcolor="SUBNET_FILL"');

      for (const node of subnet.nodes) {
        lines.push('');
        emitServiceNode(lines, node, schemeFill, schemeMain, '            ');
      }

      lines.push('        }');
    }

    lines.push('    }');
  }

  // Edges
  lines.push('');
  lines.push('    // ── Edges ────────────────────────────────────────');
  for (const edge of edges) {
    const attrs: string[] = [];
    if (edge.label) attrs.push(`label="${edge.label}"`);
    if (edge.style) attrs.push(`style=${edge.style}`);
    if (edge.color) attrs.push(`color="${edge.color}"`);
    if (edge.fontcolor) attrs.push(`fontcolor="${edge.fontcolor}"`);

    lines.push(`    ${toNodeId(edge.src)} -> ${toNodeId(edge.dst)} [`);
    for (const a of attrs) lines.push(`        ${a}`);
    lines.push('    ]');
  }

  lines.push('');
  lines.push('}');

  return lines.join('\n') + '\n';
}

function emitServiceNode(
  lines: string[],
  node: DiagramNode,
  fillcolor: string,
  borderColor: string,
  indent: string,
) {
  const shape = node.shape ?? 'box';
  const style = shape === 'cylinder' ? 'filled' : 'filled,rounded';
  lines.push(`${indent}${toNodeId(node.id)} [`);
  lines.push(`${indent}    label=<`);
  lines.push(`${indent}        <TABLE BORDER="0" CELLSPACING="0" CELLPADDING="2">`);
  lines.push(`${indent}            <TR><TD><B>${node.label}</B></TD></TR>`);
  if (node.subtitle) {
    lines.push(`${indent}            <TR><TD><FONT POINT-SIZE="8" COLOR="MUTED">${node.subtitle}</FONT></TD></TR>`);
  }
  lines.push(`${indent}        </TABLE>`);
  lines.push(`${indent}    >`);
  lines.push(`${indent}    shape=${shape}`);
  lines.push(`${indent}    style="${style}"`);
  lines.push(`${indent}    fillcolor="${fillcolor}"`);
  lines.push(`${indent}    color="${borderColor}"`);
  lines.push(`${indent}]`);
}
