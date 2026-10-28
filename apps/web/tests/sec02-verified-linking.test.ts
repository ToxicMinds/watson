// SEC-02: a submitted contact is a consultation-scoped claim, never proof of identity.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adminClient, browserClient, claimFormJob, createConsultation, localStack, newEngine, newPractitioner,
  PASSWORD, rpc, sqlAsOwner, transcriptWithFormJob, type Practitioner,
} from "./local-stack";

const stack = localStack();
let eva: Practitioner;
let finn: Practitioner;
let engine: Practitioner;

beforeAll(async () => {
  [eva, finn, engine] = await Promise.all([
    newPractitioner(stack, "sec02-eva"),
    newPractitioner(stack, "sec02-finn"),
    newEngine(stack, "sec02-engine"),
  ]);
});

async function tokenFor(who: Practitioner, consultationId: string) {
  const { data, error } = await who.client.from("consultations").select("invite_token").eq("id", consultationId).single();
  if (error || !data) throw error ?? new Error("consultation token missing");
  return data.invite_token;
}

async function admittedPatient(email: string) {
  const admin = adminClient(stack);
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("patient create failed");
  const provisioned = await admin.rpc("provision_patient_role_after_otp" as never, {
    p_user_id: created.data.user.id,
  } as never);
  if (provisioned.error) throw provisioned.error;

  const client = browserClient(stack);
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error("patient sign-in failed");
  const payload = signedIn.data.session.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const sessionId = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).session_id as string;
  const registered = await admin.rpc("register_patient_otp_session" as never, {
    p_user_id: created.data.user.id,
    p_session_id: sessionId,
    p_verified_email: email,
    p_verified_phone: null,
  } as never);
  if (registered.error) throw registered.error;
  return { id: created.data.user.id, client };
}

describe("SEC-02 verified patient linking", () => {
  it("does not treat a known contact entered through an attacker invite as identity proof", async () => {
    const suffix = randomUUID().slice(0, 8);
    const victimEmail = `victim-${suffix}@watson.test`;
    const victimPhone = `+42191${Date.now().toString().slice(-7)}`;
    const victimPatientId = sqlAsOwner(`
      insert into public.patients (practitioner_id, name, phone, email)
      values ('${eva.id}', 'Victim Original', '${victimPhone}', '${victimEmail}') returning id;
    `).split("\n")[0]!;
    const victimConsultation = await createConsultation(eva, { ref: `SYN-${Math.floor(Math.random() * 8000000 + 1000000)}` });
    expect(await rpc(eva.client, "patient_review_association", {
      p_consultation_id: victimConsultation, p_patient_id: victimPatientId, p_decision: "confirm",
    })).toMatchObject({ ok: true });

    const attackerConsultation = await createConsultation(eva, { ref: `SYN-${Math.floor(Math.random() * 8000000 + 1000000)}` });
    const attackerToken = await tokenFor(eva, attackerConsultation);
    const visitor = browserClient(stack);
    const claimed = await rpc(visitor, "patient_identify", {
      p_token: attackerToken, p_name: "Victim Renamed", p_contact: victimEmail,
    });
    expect(claimed).toEqual({ ok: true });

    const details = await rpc(visitor, "invite_details", { p_token: attackerToken });
    expect(details.patient).toEqual({ name: "Victim Renamed", contact: victimEmail });
    expect(JSON.stringify(details)).not.toContain(victimPhone);
    const victim = JSON.parse(sqlAsOwner(`select row_to_json(p) from public.patients p where id = '${victimPatientId}';`));
    expect(victim).toMatchObject({ name: "Victim Original", phone: victimPhone, email: victimEmail });
    const attackerLink = JSON.parse(sqlAsOwner(`
      select json_build_object('patient_id', patient_id, 'association_state', patient_association_state)
      from public.consultations where id = '${attackerConsultation}';
    `));
    expect(attackerLink).toEqual({ patient_id: null, association_state: "claimed" });
    const victimLink = JSON.parse(sqlAsOwner(`
      select json_build_object('patient_id', patient_id, 'association_state', patient_association_state)
      from public.consultations where id = '${victimConsultation}';
    `));
    expect(victimLink).toEqual({ patient_id: victimPatientId, association_state: "practitioner_confirmed" });

    const victimDocument = await rpc(eva.client, "add_document", {
      p_consultation_id: victimConsultation, p_file_name: "Victim result.pdf",
      p_media_type: "application/pdf", p_size_bytes: 32,
    });
    const attackerDocument = await rpc(visitor, "patient_add_document", {
      p_token: attackerToken, p_file_name: "Attacker result.pdf",
      p_media_type: "application/pdf", p_size_bytes: 32,
    });
    expect(attackerDocument).toMatchObject({ ok: true });
    sqlAsOwner(`
      update public.patient_documents set uploaded_at = now(), reading = 'read', page_texts = array['victim']
      where id = '${victimDocument.document_id}';
      update public.patient_documents set uploaded_at = now(), reading = 'read', page_texts = array['attacker']
      where id = '${attackerDocument.document_id}';
    `);
    expect(JSON.parse(sqlAsOwner(`
      select json_build_object('consultation_id', consultation_id, 'patient_id', patient_id)
      from public.patient_documents where id = '${attackerDocument.document_id}';
    `))).toEqual({ consultation_id: attackerConsultation, patient_id: null });
    transcriptWithFormJob(victimConsultation);
    const victimJob = await claimFormJob(engine, victimConsultation);
    expect(victimJob.documents.map((document) => document.document_id)).toEqual([victimDocument.document_id]);
  });

  it("links only an admitted patient session whose verified email exactly matches the claim", async () => {
    const email = `returning-${randomUUID().slice(0, 8)}@watson.test`;
    const patientId = sqlAsOwner(`
      insert into public.patients (practitioner_id, name, email)
      values ('${eva.id}', 'Canonical Name', '${email}') returning id;
    `).split("\n")[0]!;
    const consultationId = await createConsultation(eva, { ref: `SYN-${Math.floor(Math.random() * 8000000 + 1000000)}` });
    const token = await tokenFor(eva, consultationId);
    expect(await rpc(browserClient(stack), "patient_identify", {
      p_token: token, p_name: "Submitted Name", p_contact: email.toUpperCase(),
    })).toEqual({ ok: true });

    const patient = await admittedPatient(email);
    const [first, second] = await Promise.all([
      rpc(patient.client, "patient_link_consultation", { p_token: token }),
      rpc(patient.client, "patient_link_consultation", { p_token: token }),
    ]);
    expect(first).toMatchObject({ ok: true, patient_id: patientId });
    expect(second).toMatchObject({ ok: true, patient_id: patientId });
    expect(JSON.parse(sqlAsOwner(`
      select json_build_object('patient_id', patient_id, 'association_state', patient_association_state)
      from public.consultations where id = '${consultationId}';
    `))).toEqual({ patient_id: patientId, association_state: "verified" });
    expect(JSON.parse(sqlAsOwner(`select row_to_json(p) from public.patients p where id = '${patientId}';`)))
      .toMatchObject({ name: "Canonical Name", email });
  });

  it("requires the owning practitioner to confirm or reject an association", async () => {
    const claimEmail = `claim-${randomUUID().slice(0, 8)}@watson.test`;
    const patientId = sqlAsOwner(`
      insert into public.patients (practitioner_id, name, email)
      values ('${eva.id}', 'Review Patient', 'review-${randomUUID().slice(0, 8)}@watson.test') returning id;
    `).split("\n")[0]!;
    const consultationId = await createConsultation(eva, { ref: `SYN-${Math.floor(Math.random() * 8000000 + 1000000)}` });
    const token = await tokenFor(eva, consultationId);
    await rpc(browserClient(stack), "patient_identify", {
      p_token: token, p_name: "Claimed Patient", p_contact: claimEmail,
    });

    expect(await rpc(finn.client, "patient_review_association", {
      p_consultation_id: consultationId, p_patient_id: patientId, p_decision: "confirm",
    })).toEqual({ ok: false, error_category: "NOT_FOUND" });
    expect(await rpc(engine.client, "patient_review_association", {
      p_consultation_id: consultationId, p_patient_id: patientId, p_decision: "confirm",
    })).toEqual({ ok: false, error_category: "NOT_A_PRACTITIONER" });
    expect(await rpc(eva.client, "patient_review_association", {
      p_consultation_id: consultationId, p_patient_id: patientId, p_decision: "reject",
    })).toEqual({ ok: true, association_state: "rejected" });
    expect(await rpc(eva.client, "patient_review_association", {
      p_consultation_id: consultationId, p_patient_id: patientId, p_decision: "confirm",
    })).toMatchObject({ ok: true, patient_id: patientId, association_state: "practitioner_confirmed" });
    const verifiedClaimOwner = await admittedPatient(claimEmail);
    expect(await rpc(verifiedClaimOwner.client, "patient_link_consultation", { p_token: token }))
      .toEqual({ ok: false, error_category: "ASSOCIATION_CONFLICT" });
  });
});
