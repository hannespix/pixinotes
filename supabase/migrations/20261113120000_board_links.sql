-- PixiNotes M357: Ein Board per Link für alle teilen — ohne Konto zu öffnen.
--
-- Der Besitzer legt eine FASSUNG seines Boards in den Dateispeicher (Bucket „pixinotes",
-- Ordner <user_id>/link-<token>/): die Board-Datei und die Anhänge. Diese Tabelle merkt sich
-- je Board einen Link: das Token (128 Bit Zufall, steht im Link) und die signierten Adressen
-- der Dateien. Wer das Token kennt, bekommt über `link_lesen` genau diese Adressen — sonst nichts.
-- Ohne Token ist nichts auffindbar: Die Tabelle hat keine Regel für anonyme Zugriffe, der
-- Dateispeicher bleibt privat (signierte Adressen gelten nur für die eine Datei).
-- Löscht der Besitzer den Link, sind Zeile und Dateien weg.

create table if not exists public.board_links (
  token      text        primary key,
  besitzer   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id   text        not null,
  name       text        not null default '',
  board_url  text        not null,
  dateien    jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_links_token check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  constraint board_links_name check (char_length(name) <= 300),
  constraint board_links_url check (char_length(board_url) between 10 and 4000),
  constraint board_links_dateien check (jsonb_typeof(dateien) = 'array' and pg_column_size(dateien) <= 512 * 1024),
  constraint board_links_einmal unique (besitzer, board_id)
);

comment on table public.board_links is 'PixiNotes M357: Link-Freigabe — je Board ein Token und die signierten Adressen der geteilten Fassung.';

create or replace function public.board_links_vor_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.besitzer := old.besitzer;
  new.token := old.token;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists board_links_vor_update on public.board_links;
create trigger board_links_vor_update
  before update on public.board_links
  for each row execute function public.board_links_vor_update();

alter table public.board_links enable row level security;

drop policy if exists "Besitzer verwaltet Links" on public.board_links;
create policy "Besitzer verwaltet Links" on public.board_links for all to authenticated
  using (besitzer = auth.uid()) with check (besitzer = auth.uid());

revoke all on public.board_links from anon;
grant select, insert, update, delete on public.board_links to authenticated;

-- Wer das Token kennt, bekommt Name, Stand und die Adressen — nicht den Besitzer, nicht die Board-Kennung.
create or replace function public.link_lesen(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', l.name, 'board_url', l.board_url, 'dateien', l.dateien, 'stand', l.updated_at)
    from public.board_links l
   where l.token = p_token;
$$;

revoke all on function public.link_lesen(text) from public;
grant execute on function public.link_lesen(text) to anon, authenticated;
