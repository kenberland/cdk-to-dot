# TODO

## Replace `Service` placeholders with real CDK constructs

The `Service` class in `lib/external.ts` is a lightweight `Construct` subclass
that only holds diagram metadata — it doesn't map to any AWS resource.

Consider replacing these with real CDK constructs (`ec2.Instance`, etc.) so the
stack is deployable, not just a diagram source. The diagram generator would need
`instanceof ec2.Instance` checks alongside the existing `instanceof Service`.

Trade-offs:
- Real constructs require valid props (AMI, instance type, VPC placement) even
  though we never synthesize today.
- Keeps the CDK definition honest — the diagram reflects actual infrastructure,
  not just labels.
- Some services (e.g. Redis/ElastiCache, RDS) would use different construct
  classes, so the diagram generator needs a wider set of instanceof checks or a
  shared metadata convention.
