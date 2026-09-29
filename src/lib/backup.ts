import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BACKUP_DIR =
  process.env.LBMS_BACKUP_DIR?.trim() || "/home/lbmsdeploy/backups/lbms";

const MAX_BACKUPS = 30;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  return value;
}

function postgresConnection(): URL {
  const raw = databaseUrl();
  const url = new URL(raw);
  return url;
}

function postgresEnv(): NodeJS.ProcessEnv {
  const url = postgresConnection();
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer",
  };
}

async function postgresBinary(name: "pg_dump" | "pg_restore"): Promise<string> {
  const candidates = [
    `/usr/local/apps/pgsql18/bin/${name}`,
    `/usr/local/apps/pgsql17/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`${name} is not installed on the production host.`);
}

function safeBackupName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Invalid backup name.");
  }
  return cleaned.slice(0, 80);
}

function backupPath(id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id.includes("..")) {
    throw new Error("Invalid backup identifier.");
  }
  return join(BACKUP_DIR, id.endsWith(".dump") ? id : `${id}.dump`);
}

export async function ensureBackupDirectory(): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
}

export async function createDatabaseBackup(label?: string): Promise<{
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
}> {
  await ensureBackupDirectory();
  const pgDump = await postgresBinary("pg_dump");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = label ? `${safeBackupName(label)}-` : "";
  const fileName = `lbms-${prefix}${timestamp}.dump`;
  const filePath = join(BACKUP_DIR, fileName);

  try {
    await execFileAsync(
      pgDump,
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        filePath,
        "--dbname",
        decodeURIComponent(new URL(databaseUrl()).pathname.replace(/^\//, "")),
      ],
      { timeout: 10 * 60 * 1000, maxBuffer: 2 * 1024 * 1024, env: postgresEnv() },
    );

    await execFileAsync(
      await postgresBinary("pg_restore"),
      ["--list", filePath],
      { timeout: 2 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, env: postgresEnv() },
    );

    const info = await stat(filePath);
    if (info.size < 100) throw new Error("Backup validation produced an unexpectedly small file.");

    await pruneBackups(MAX_BACKUPS);
    return {
      id: basename(filePath, ".dump"),
      fileName,
      size: info.size,
      createdAt: info.birthtime.toISOString(),
    };
  } catch (error) {
    try { await unlink(filePath); } catch {}
    const message = error instanceof Error ? error.message : "Backup creation failed.";
    throw new Error(message);
  }
}

export async function listDatabaseBackups() {
  await ensureBackupDirectory();
  const entries = await readdir(BACKUP_DIR, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".dump")) continue;
    try {
      const info = await stat(join(BACKUP_DIR, entry.name));
      backups.push({
        id: basename(entry.name, ".dump"),
        fileName: entry.name,
        size: info.size,
        createdAt: info.mtime.toISOString(),
      });
    } catch {}
  }

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteDatabaseBackup(id: string): Promise<void> {
  await unlink(backupPath(id));
}

export async function restoreDatabaseBackup(id: string): Promise<{
  preRestoreBackup: string;
  restoredBackup: string;
}> {
  const filePath = backupPath(id);
  await stat(filePath);

  // Always create a safety snapshot before destructive restoration.
  const safety = await createDatabaseBackup("pre-restore");
  const pgRestore = await postgresBinary("pg_restore");

  try {
    await execFileAsync(
      pgRestore,
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        decodeURIComponent(new URL(databaseUrl()).pathname.replace(/^\//, "")),
        filePath,
      ],
      { timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, env: postgresEnv() },
    );

    // Confirm the archive is still readable after the restore operation.
    await execFileAsync(
      pgRestore,
      ["--list", filePath],
      { timeout: 2 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
    );

    return { preRestoreBackup: safety.fileName, restoredBackup: basename(filePath) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database restore failed.";
    throw new Error(`Database restore failed. Safety backup: ${safety.fileName}. ${message}`);
  }
}

async function pruneBackups(max: number): Promise<void> {
  const backups = await listDatabaseBackups();
  for (const old of backups.slice(max)) {
    try { await unlink(backupPath(old.id)); } catch {}
  }
}

export function getBackupPath(id: string): string {
  return backupPath(id);
}
