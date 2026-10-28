// src/lib/tableSig.js
// امضای دیجیتال شماره میز برای اثبات حضور فیزیکی مشتری پشت میز (QR code verification)

import { safeCompare } from "./safeCompare.js";

export async function signTable(table, secret) {
  if (!secret || table == null) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(table))
  );
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyTableSig(table, sig, secret) {
  if (!secret) return true; // backward compatible: اگر secret ست نشده باشد چک غیرفعال است
  if (!sig || typeof sig !== "string") return false;
  const expected = await signTable(table, secret);
  return safeCompare(expected, sig);
}
