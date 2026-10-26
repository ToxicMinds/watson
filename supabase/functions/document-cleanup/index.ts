// Remove a tombstoned document through the trusted Storage API. The tombstone
// remains durable so failed cleanup can be retried without restoring read access.
import { admin, reply, SITES } from "../_shared/server.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return reply(origin, 204, null);
  if (request.method !== "POST" || !origin || !SITES.includes(origin)) {
    return reply(origin, 403, { ok: false, error: "FORBIDDEN" });
  }

  let input: { document_id?: unknown; token?: unknown };
  try {
    input = await request.json();
  } catch {
    return reply(origin, 400, { ok: false, error: "VALIDATION" });
  }
  const documentId = typeof input.document_id === "string" && UUID.test(input.document_id)
    ? input.document_id
    : null;
  const token = typeof input.token === "string" && TOKEN.test(input.token) ? input.token : null;
  if (!documentId || (input.token !== undefined && !token)) {
    return reply(origin, 400, { ok: false, error: "VALIDATION" });
  }

  let practitionerId: string | null = null;
  let consultationId: string | null = null;
  if (token) {
    const { data: consultation } = await admin.from("consultations")
      .select("id").eq("invite_token", token).maybeSingle();
    if (!consultation) return reply(origin, 404, { ok: false, error: "NOT_FOUND" });
    consultationId = consultation.id;
  } else {
    const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return reply(origin, 401, { ok: false, error: "NOT_AUTHENTICATED" });
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data.user) return reply(origin, 401, { ok: false, error: "NOT_AUTHENTICATED" });
    practitionerId = data.user.id;
  }

  let documentQuery = admin.from("patient_documents")
    .select("id, storage_path, removed_at, cleanup_completed_at, source, consultation_id, practitioner_id")
    .eq("id", documentId).not("removed_at", "is", null);
  documentQuery = token
    ? documentQuery.eq("consultation_id", consultationId!).eq("source", "patient")
    : documentQuery.eq("practitioner_id", practitionerId!);
  const { data: document, error: documentError } = await documentQuery.maybeSingle();
  if (documentError || !document) return reply(origin, 404, { ok: false, error: "NOT_FOUND" });
  if (document.cleanup_completed_at) return reply(origin, 200, { ok: true });

  const slash = document.storage_path.lastIndexOf("/");
  const folder = document.storage_path.slice(0, slash);
  const name = document.storage_path.slice(slash + 1);
  const bucket = admin.storage.from("documents");

  // Check first so a retry after a successful delete but failed DB acknowledgement is idempotent.
  const { data: objects, error: listError } = await bucket.list(folder, { search: name, limit: 100 });
  if (listError || !objects) return reply(origin, 503, { ok: false, error: "CLEANUP_PENDING" });
  if (objects?.some((object) => object.name === name)) {
    const { error: removeError } = await bucket.remove([document.storage_path]);
    if (removeError) {
      const { data: remaining, error: retryListError } = await bucket.list(folder, { search: name, limit: 100 });
      if (retryListError || !remaining || remaining.some((object) => object.name === name)) {
        return reply(origin, 503, { ok: false, error: "CLEANUP_PENDING" });
      }
    }
  }

  const { data: completed, error: completionError } = await admin.rpc("complete_document_cleanup", {
    p_document_id: documentId,
  });
  if (completionError || completed !== true) {
    return reply(origin, 503, { ok: false, error: "CLEANUP_PENDING" });
  }
  return reply(origin, 200, { ok: true });
});
