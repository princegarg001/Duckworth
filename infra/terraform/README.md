# Infrastructure as code

Terraform for the GCP footprint: a VPC with a private Cloud SQL instance,
Artifact Registry, and the two Cloud Run services.

## What is deliberate here

- **Remote state in GCS, with locking.** Local state is a single laptop away
  from an unrecoverable environment, and two people applying at once is a
  corrupted state file. The backend is configured before anything else.
- **No secret ever appears in a variable default.** Database credentials are
  generated into Secret Manager and referenced by name; `terraform plan` output
  is safe to post publicly, which is what makes the PR-comment workflow safe.
- **`plan` on pull request, `apply` only on merge**, behind a manual-approval
  environment. The plan is posted as a PR comment so the diff is reviewed
  before it is applied, not after.
- **Cloud SQL has private IP only**, reached through a VPC connector. The
  database is not on the internet.

## Layout

```
modules/
  network/    VPC, subnet, VPC access connector, private service access
  database/   Cloud SQL for PostgreSQL 17, backups, PITR, private IP
  registry/   Artifact Registry with vulnerability scanning
  runtime/    Cloud Run services, IAM, and the ingest Job
envs/
  prod/       Composition + backend config for the production project
```

## Status

The modules are written and `terraform validate` runs in CI. **They have not
been applied to a live GCP project** — this submission has no billing account
attached, and shipping infrastructure code claiming to be running when it has
never been applied would be exactly the sort of thing that should not be
trusted. See the deployment section of the root README for what is and is not
live.
