-- M360: Einladungslink für geteilte Boards.
--
-- Der Besitzer legt je Board EIN Token an und gibt den Link …#e=<token> weiter.
-- Wer ihn angemeldet öffnet, wird über einladung_annehmen() als Gast in
-- board_freigaben eingetragen — mit der Rolle des Links (bearbeiten | lesen).
-- Danach gilt alles aus M330 (Lesen per RLS, Schreiben per freigabe_schreiben,
-- das die Rolle prüft). Die Tabelle selbst sieht nur der Besitzer; das Token
-- ist 128 Bit Zufall und wird nur über die Funktion eingelöst.
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen.

create table if not exists public.board_einladungen (
  token      text        primary key check (length(token) between 16 and 64),
  besitzer   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id   text        not null,
  rolle      text        not null default 'bearbeiten' check (rolle in ('bearbeiten', 'lesen')),
  created_at timestamptz not null default now(),
  constraint board_einladungen_eindeutig unique (besitzer, board_id)
);
comment on table public.board_einladungen is 'PixiNotes M360: Einladungslink eines Besitzers für ein Board (Rolle bearbeiten oder lesen).';

alter table public.board_einladungen enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'board_einladungen' and policyname = 'Besitzer verwaltet Einladungen') then
    create policy "Besitzer verwaltet Einladungen" on public.board_einladungen for all to authenticated
      using (besitzer = (select auth.uid())) with check (besitzer = (select auth.uid()));
  end if;
end $$;

grant select, insert, update, delete on public.board_einladungen to authenticated;
revoke all on table public.board_einladungen from anon;

-- Eine Einladung einlösen: trägt den Aufrufer als Gast ein (oder übernimmt eine
-- wartende E-Mail-Freigabe). Eine schon bestehende Freigabe behält ihre Rolle —
-- die hat der Besitzer für diese Person bewusst gesetzt.
create or replace function public.einladung_annehmen(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.board_einladungen%rowtype;
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_rolle text;
begin
  if auth.uid() is null or mail = '' then
    raise exception 'nicht angemeldet' using errcode = '28000';
  end if;
  select * into e from public.board_einladungen where token = p_token;
  if not found then
    return null;
  end if;
  if e.besitzer = auth.uid() then
    return jsonb_build_object('board_id', e.board_id, 'rolle', e.rolle, 'eigen', true);
  end if;
  insert into public.board_freigaben (besitzer, board_id, gast_email, gast_id, rolle)
  values (e.besitzer, e.board_id, mail, auth.uid(), e.rolle)
  on conflict (besitzer, board_id, gast_email) do update set gast_id = auth.uid()
  returning rolle into v_rolle;
  return jsonb_build_object(
    'board_id', e.board_id,
    'rolle', v_rolle,
    'eigen', false,
    'besitzer_email', (select u.email::text from auth.users u where u.id = e.besitzer)
  );
end;
$$;

revoke all on function public.einladung_annehmen(text) from public, anon;
grant execute on function public.einladung_annehmen(text) to authenticated;
