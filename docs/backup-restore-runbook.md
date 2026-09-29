# LBMS Backup & Restore Runbook

## Scope

The Backup & Restore module manages logical PostgreSQL backups for the LBMS production database.

- Backup format: PostgreSQL custom archive (.dump)
- Storage: /home/lbmsdeploy/backups/lbms by default
- Retention: latest 30 backup archives
- Backup files are outside the Git working tree
- Backup archives are validated with pg_restore --list before being listed
- Restore automatically creates a new pre-restore safety backup first
- Production restore is restricted to the Managing Director
- Backup creation/download/restore/delete operations are written to the LBMS audit trail

PostgreSQL pg_dump supports the database connection parameters used by the module, while pg_restore restores the custom archive format.

## Normal operation

1. Open Administration → Backup & Restore.
2. Enter an optional label.
3. Select Create Backup.
4. Wait for the archive to be validated.
5. Download a copy and retain it in secure off-host storage.

## Restore

Restore is destructive.

1. Select the required verified backup.
2. Select Restore.
3. Type exactly RESTORE.
4. LBMS creates a fresh safety backup.
5. LBMS restores the selected PostgreSQL archive.
6. Refresh the application session after completion.

The application never accepts an arbitrary filesystem path from the browser. Backup identifiers are validated before being mapped into the isolated backup directory.

## Important operational rule

A server-local backup is not a complete disaster-recovery strategy. Keep at least one additional copy in secure off-host storage and periodically perform a controlled restore test.

## Deployment

The production deployment script creates the isolated backup directory with mode 700. Git checkouts do not contain database dump files, and the application never stores production backups in the repository.
