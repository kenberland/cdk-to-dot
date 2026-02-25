# TODO

## Replace remaining `Service` constructs with real AWS resources

Several constructs in `network-stack.ts` still use the placeholder `Service`
class from `lib/external.ts`. Each should be replaced with the corresponding
CDK construct and get a focused diagram.

### VPC-A

- [ ] **ELB** → `elbv2.ApplicationLoadBalancer`
  - Currently `Service(vpcA, 'Elb', ...)`. Needs target groups, listeners,
    and security group configuration. Add an ELB/ALB focused diagram.

### VPC-B (Internal / Tooling)

- [ ] **CI/CD Runners** → `ServerFleet` or dedicated construct
  - 4 instances (Jenkins + GH Actions). Could reuse `ServerFleet` from
    `lib/compute.ts`.

- [ ] **Artifacts** → `s3.Bucket`
  - S3 object store at 172.16.1.100. Needs bucket policy, encryption config.
    Add an S3 focused diagram.

- [ ] **Monitoring** → `ServerFleet` or dedicated construct
  - Prometheus + Grafana at 172.16.1.50. Could reuse `ServerFleet`.

- [ ] **Log Aggregator** → `ServerFleet` or OpenSearch
  - ELK Stack at 172.16.1.200. Could be `ServerFleet` or
    `opensearch.Domain` if switching to AWS-managed.

## Replace remaining custom constructs

- [ ] **NatGatewayNode** → `ec2.CfnNatGateway` + `ec2.CfnEIP`
  - Currently a metadata-only construct. Real NAT gateways need an EIP and
    public subnet placement.

- [ ] **Firewall SecurityGroup** → use real `addIngressRule` calls
  - The SG exists as a real `ec2.SecurityGroup` but the firewall rules are
    hardcoded in `diagram:rules` metadata. The rules should come from actual
    ingress rules on the construct.

## Constructs that should stay as-is

- **ExternalService** (API A, API B) — represents third-party services outside
  AWS. No real resource to map to.
- **InternetNode** — diagram-only representation of the internet.
- **SubnetGroup** — diagram-only AZ grouping. Real subnets are created by
  `ec2.Vpc`.

## Housekeeping

- [ ] Add `test/` to `tsconfig.json` includes so `tsc` compiles tests
- [ ] Consider extracting the repeated construct-walker pattern in `diagram.ts`
      into a shared collector function
- [ ] Consider auto-generating `index.html` from the diagram registry instead
      of maintaining it manually
