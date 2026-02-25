import { Construct } from 'constructs';

export function getMeta(c: Construct, key: string): string | undefined {
  const entry = c.node.metadata.find(e => e.type === key);
  return entry?.data as string | undefined;
}

export function toNodeId(constructId: string): string {
  return constructId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export const COLOR_SCHEMES: Record<string, {
  main: string; alt: string; nodeFill: string; natFill: string;
}> = {
  BLUE: { main: 'BLUE', alt: 'BLUE_ALT', nodeFill: 'NODE_BLUE_FILL', natFill: 'BLUE_ALT_FILL' },
  GREEN: { main: 'GREEN', alt: 'GREEN_ALT', nodeFill: 'NODE_GREEN_FILL', natFill: 'GREEN_FILL' },
};
