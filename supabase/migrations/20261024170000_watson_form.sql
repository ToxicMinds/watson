-- Watson's own consultation form (owner, 24 October 2026). Dr. Robin's two sheets are what he
-- follows: "learn from it but make it a 100 times better and more intuitive. Understand what info we
-- might need from such a consultation with a client." The patient's name, the date, the practitioner
-- and the signature come from the records, not the conversation, so they are not fields here.
-- A field in 'manual' mode is the practitioner's alone: Watson never fills it in.

create or replace function private.valid_template(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and jsonb_typeof(p -> 'title') = 'string' and char_length(p ->> 'title') between 1 and 120
    and jsonb_typeof(p -> 'sections') = 'array' and jsonb_array_length(p -> 'sections') between 1 and 20
    and not exists (
      select 1 from jsonb_array_elements(p -> 'sections') s
      where jsonb_typeof(s -> 'title') is distinct from 'string'
         or char_length(s ->> 'title') not between 1 and 120
         or jsonb_typeof(s -> 'fields') is distinct from 'array'
         or jsonb_array_length(s -> 'fields') not between 1 and 40)
    and not exists (
      select 1 from jsonb_array_elements(p -> 'sections') s, jsonb_array_elements(s -> 'fields') f
      where coalesce(f ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
         or char_length(coalesce(f ->> 'label', '')) not between 1 and 120
         or coalesce(f ->> 'mode', 'extract') not in ('extract', 'suggest', 'manual')
         or char_length(coalesce(f ->> 'hint', '')) > 300)
    and (select count(*) = count(distinct f ->> 'key')
         from jsonb_array_elements(p -> 'sections') s, jsonb_array_elements(s -> 'fields') f);
$$;

create function private.watson_form() returns jsonb
language sql immutable set search_path = ''
as $$
  select $form$
{"title": "Ayurvedic consultation", "sections": [
 {"title": "About the patient", "fields": [
  {"key": "age", "label": "Age", "hint": "Age in years, as the patient said it."},
  {"key": "place_of_living", "label": "Place of living", "hint": "Town or city where the patient lives."},
  {"key": "work", "label": "Work", "hint": "What the patient does for a living, and how demanding it is: hours, shifts, sitting or physical work."}]},
 {"title": "Reason for the visit", "fields": [
  {"key": "main_concern", "label": "Main concern", "hint": "What the patient wants help with, in their own words."},
  {"key": "history_of_concern", "label": "Since when, and how it has changed", "hint": "When it began, how often it happens, and how it has developed."},
  {"key": "better_worse", "label": "What makes it better or worse", "hint": "Foods, times of day, seasons, stress or activities that ease or worsen it."},
  {"key": "tried_so_far", "label": "Tried so far", "hint": "Doctors, treatments, therapies or remedies already tried, and how they worked."},
  {"key": "goals", "label": "What the patient hopes for", "hint": "What the patient wants to achieve with this treatment."}]},
 {"title": "Health history", "fields": [
  {"key": "conditions", "label": "Diagnosed conditions", "hint": "Illnesses diagnosed by doctors, past and present."},
  {"key": "medicines", "label": "Medicines and supplements", "hint": "Every medicine, herb and supplement the patient takes, with dose and timing when said."},
  {"key": "allergies", "label": "Allergies and intolerances", "hint": "Allergies, food intolerances and bad reactions to medicines or foods."},
  {"key": "operations", "label": "Operations and hospital stays", "hint": "Operations and stays in hospital, with years when said."},
  {"key": "family_history", "label": "Family history", "hint": "Illnesses of the patient's parents, brothers, sisters or children."}]},
 {"title": "Daily life", "fields": [
  {"key": "diet", "label": "Diet", "hint": "What and when the patient eats: meals, snacks, cravings, cold or raw food, eating late."},
  {"key": "digestion", "label": "Appetite and digestion", "hint": "Hunger, bloating, gas, acidity or heaviness after meals."},
  {"key": "bowel_movements", "label": "Bowel movements", "hint": "How often, and whether hard, loose or regular."},
  {"key": "sleep", "label": "Sleep", "hint": "Falling asleep, waking at night, hours slept, and how rested the patient feels in the morning."},
  {"key": "energy_mood", "label": "Energy, mood and stress", "hint": "Energy through the day, mood, worry, stress and how the patient copes."},
  {"key": "activity", "label": "Exercise and movement", "hint": "Walking, sport, yoga or other movement, and how often."},
  {"key": "habits", "label": "Drinks, coffee, alcohol and smoking", "hint": "Water and other drinks, tea, coffee, alcohol and smoking: what and how much."},
  {"key": "menstrual_cycle", "label": "Menstrual cycle", "hint": "Regularity, pain, flow, or menopause, if the patient spoke about it."},
  {"key": "pregnancy_children", "label": "Pregnancy and children", "hint": "Pregnancy, breastfeeding, births and children, if the patient spoke about it."}]},
 {"title": "Assessment", "fields": [
  {"key": "constitution", "label": "Constitution (Prakriti)", "mode": "suggest", "hint": "The patient's lifelong balance of the doshas, from what the patient described."},
  {"key": "imbalance", "label": "Current imbalance (Vikriti)", "mode": "suggest", "hint": "Which dosha is out of balance now, and the signs of it in what the patient described."},
  {"key": "agni_ama", "label": "Digestive fire and toxins (Agni, Ama)", "mode": "suggest", "hint": "The state of digestion and any signs of ama, from what the patient described."},
  {"key": "assessment", "label": "Assessment", "mode": "suggest", "hint": "The practitioner's diagnosis of the present condition."},
  {"key": "safety", "label": "Safety notes", "mode": "suggest", "hint": "Warning signs that need a medical doctor, and herbs that may not suit the medicines, pregnancy or conditions named. Leave empty if there are none."}]},
 {"title": "Plan", "fields": [
  {"key": "therapies", "label": "Therapies", "hint": "Therapies the practitioner recommended, such as Abhyanga or Shirodhara, with how often."},
  {"key": "herbs", "label": "Herbs and supplements", "hint": "Each herb, remedy or supplement the practitioner recommended, with dose, timing and for how long."},
  {"key": "diet_plan", "label": "Food to favour and to avoid", "hint": "Foods, drinks and meal times the practitioner recommended or advised against."},
  {"key": "daily_routine", "label": "Daily routine", "hint": "Morning rituals, drinking routine, bedtime and other daily habits the practitioner recommended."},
  {"key": "yoga_breathing", "label": "Yoga, breathing and meditation", "hint": "Yoga poses, pranayama or meditation the practitioner recommended."},
  {"key": "exercise", "label": "Exercise", "hint": "Exercise or movement the practitioner recommended."},
  {"key": "programme", "label": "Individual programme", "hint": "Whether an individual programme was agreed, and for how many days."},
  {"key": "review", "label": "Review", "hint": "When the patient should come back, or the date of the next consultation."},
  {"key": "referral", "label": "Referral or tests", "hint": "A doctor, specialist or tests the practitioner suggested. Leave empty if none."}]},
 {"title": "For you only", "fields": [
  {"key": "private_notes", "label": "Private notes", "mode": "manual", "hint": "Your own notes. Watson never fills this in, and it is never shared with the patient."}]}
]}
$form$::jsonb;
$$;

-- One press: the practitioner's form becomes Watson's, unless they already have their own.
create function public.use_watson_form() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    return private.refuse('NOT_SIGNED_IN');
  end if;
  if private.is_engine() then
    return private.refuse('NOT_A_PRACTITIONER');
  end if;
  insert into public.form_templates (practitioner_id, definition) values (v_user, private.watson_form())
    on conflict (practitioner_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function private.watson_form() from public, anon, authenticated, service_role;
revoke all on function public.use_watson_form() from public, anon, service_role;
grant execute on function public.use_watson_form() to authenticated;

-- Everyone already on Watson without a form of their own gets Watson's (engines excepted).
insert into public.form_templates (practitioner_id, definition)
  select u.id, private.watson_form() from auth.users u
  where not exists (select 1 from public.engines e where e.user_id = u.id)
    and not exists (select 1 from public.form_templates t where t.practitioner_id = u.id);
