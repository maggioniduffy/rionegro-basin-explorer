/**
 * Shared Cloudflare R2 (S3 API) client for the content scripts. The bucket is a parameter so
 * other buckets (B1.2) can reuse it. Credentials come from env and are never printed.
 */
import { S3Client } from "@aws-sdk/client-s3";

const REQUIRED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

export function r2Env(bucketVar: string): { bucket: string } {
  const missing = [...REQUIRED, bucketVar].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing env var(s): ${missing.join(", ")} (see .env.example)`,
    );
  }
  return { bucket: process.env[bucketVar] as string };
}

export function r2Client(): S3Client {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length)
    throw new Error(
      `Missing env var(s): ${missing.join(", ")} (see .env.example)`,
    );
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
}
