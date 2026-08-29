// Content-addressed local blob store (A5). S3 later; same interface.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "@worldgraph/core";

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export interface BlobStore {
  put(key: string, data: string | Buffer): void;
  get(key: string): Buffer | null;
}

export class FsBlobStore implements BlobStore {
  constructor(private root: string = env.blobDir) {}
  private p(key: string) { return path.join(this.root, key); }
  put(key: string, data: string | Buffer): void {
    const fp = this.p(key);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, data);
  }
  get(key: string): Buffer | null {
    const fp = this.p(key);
    return existsSync(fp) ? readFileSync(fp) : null;
  }
}

export const blobKey = (investigationId: string, hash: string, ext: string) => `inv/${investigationId}/src/${hash}.${ext}`;
