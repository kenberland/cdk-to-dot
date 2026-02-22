# Network Diagram

AWS network architecture diagram generated from CDK construct definitions.

The CDK stack in `lib/network-stack.ts` is the single source of truth. A
diagram generator walks the construct tree (without synthesizing CloudFormation)
and emits a Graphviz DOT file with color-token placeholders. The `render` script
applies a theme and produces an SVG.

## Prerequisites

- **Node.js** (>= 18)
- **Graphviz** (`dot` command)
  ```
  sudo apt install graphviz    # Debian/Ubuntu
  brew install graphviz         # macOS
  ```

## Setup

```
npm install
```

## Usage

Generate and render in one step:

```
npm run render
```

This regenerates `network.dot` from the CDK stack, applies the print theme,
and writes `network.svg`.

### Options

Options are passed after `--`:

```
npm run render -- -t dark       # dark theme
npm run render -- --no-cdk      # skip CDK regeneration, render existing .dot
npm run render -- -o out.svg    # custom output path
```

| Flag | Description |
|------|-------------|
| `-t print` | Print-friendly black & white theme (default) |
| `-t dark` | Dark theme |
| `--no-cdk` | Skip regenerating `network.dot` from CDK |
| `-o FILE` | Output to a custom path instead of `network.svg` |

To regenerate the DOT file without rendering:

```
npm run diagram
```

## Project structure

```
├── package.json              # npm deps & scripts
├── tsconfig.json
├── bin/
│   ├── render                # Python script — applies theme + runs Graphviz
│   ├── app.ts                # CDK app entrypoint (for deploy, if ever needed)
│   └── generate-diagram.ts   # Diagram generation entrypoint
├── lib/
│   ├── network-stack.ts      # Infrastructure definition (source of truth)
│   ├── diagram.ts            # Construct tree → DOT converter
│   └── external.ts           # Lightweight constructs (Service, SubnetGroup, etc.)
├── network.dot               # Generated DOT file
└── network.svg               # Rendered diagram
```

## Editing the diagram

Modify `lib/network-stack.ts` — add constructs, change CIDRs, update
connections — then run `npm run render` to regenerate. CIDR-derived values
(subnet labels, host counts, IP ranges) are computed automatically.

Key constructs:

- `ec2.Vpc` — rendered as a cluster with nested subnet subgraphs
- `SubnetGroup` — groups services into an AZ within a VPC
- `Service` — a node inside a VPC/subnet (label, IP, description)
- `ExternalService` — a node outside any VPC (external APIs)
- `NatGatewayNode` — NAT gateway with EIP
- `InternetNode` — the cloud icon
- `addConnections()` — defines edges between constructs

All diagram-specific properties are stored as `node.addMetadata('diagram:*', ...)`
annotations on the constructs.
