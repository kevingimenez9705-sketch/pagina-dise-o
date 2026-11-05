-- Mesa de Diseño: miembros habilitados, pedidos y comentarios (tablas con prefijo mesa_)
-- Aplicada en el proyecto Supabase "Examenes-Emi" (lyvjunfgobisrfdccrnq).

create table public.mesa_miembros (
  alias text primary key check (char_length(alias) between 1 and 30),
  nombre text not null,
  email text unique check (email is null or email = lower(email)),
  es_disenador boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.mesa_miembros is 'Mesa de Diseño: personas habilitadas. Solo los emails cargados acá pueden usar la Mesa.';

-- Alias del usuario logueado (null si no está habilitado)
create or replace function public.mesa_mi_alias()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.alias
  from public.mesa_miembros m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

create or replace function public.mesa_es_miembro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.mesa_mi_alias() is not null
$$;

revoke execute on function public.mesa_mi_alias() from public, anon;
revoke execute on function public.mesa_es_miembro() from public, anon;
grant execute on function public.mesa_mi_alias() to authenticated;
grant execute on function public.mesa_es_miembro() to authenticated;

create table public.mesa_pedidos (
  id bigint generated always as identity primary key,
  titulo text not null check (char_length(btrim(titulo)) between 1 and 160),
  marca text not null,
  area text not null,
  tipo text not null,
  prioridad text not null default 'Media'
    check (prioridad in ('Baja', 'Media', 'Alta', 'Urgente')),
  disenador text references public.mesa_miembros(alias) on update cascade on delete set null,
  entrega date,
  estado text not null default 'Nuevas'
    check (estado in ('Nuevas', 'En progreso', 'En revisión', 'Con cambios', 'Aprobadas', 'Entregadas')),
  impresion boolean not null default false,
  link text check (link is null or link ~* '^https?://'),
  descripcion text check (descripcion is null or char_length(descripcion) <= 4000),
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mesa_pedidos_disenador_idx on public.mesa_pedidos (disenador);

create table public.mesa_comentarios (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.mesa_pedidos(id) on delete cascade,
  autor text,
  texto text not null check (char_length(btrim(texto)) between 1 and 1000),
  sistema boolean not null default false,
  created_at timestamptz not null default now()
);

create index mesa_comentarios_pedido_idx on public.mesa_comentarios (pedido_id);

-- Autoría y fechas las pone el servidor, no el navegador
create or replace function public.mesa_pedidos_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := public.mesa_mi_alias();
    new.created_at := now();
  else
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger mesa_pedidos_before_write
before insert or update on public.mesa_pedidos
for each row execute function public.mesa_pedidos_before_write();

create or replace function public.mesa_comentarios_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.autor := public.mesa_mi_alias();
  new.created_at := now();
  return new;
end
$$;

create trigger mesa_comentarios_before_insert
before insert on public.mesa_comentarios
for each row execute function public.mesa_comentarios_before_insert();

-- Seguridad: solo miembros habilitados y logueados
alter table public.mesa_miembros enable row level security;
alter table public.mesa_pedidos enable row level security;
alter table public.mesa_comentarios enable row level security;

revoke all on public.mesa_miembros, public.mesa_pedidos, public.mesa_comentarios from anon;

create policy mesa_miembros_select on public.mesa_miembros
  for select to authenticated using ((select public.mesa_es_miembro()));

create policy mesa_pedidos_select on public.mesa_pedidos
  for select to authenticated using ((select public.mesa_es_miembro()));
create policy mesa_pedidos_insert on public.mesa_pedidos
  for insert to authenticated with check ((select public.mesa_es_miembro()));
create policy mesa_pedidos_update on public.mesa_pedidos
  for update to authenticated using ((select public.mesa_es_miembro())) with check ((select public.mesa_es_miembro()));
create policy mesa_pedidos_delete on public.mesa_pedidos
  for delete to authenticated using ((select public.mesa_es_miembro()));

create policy mesa_comentarios_select on public.mesa_comentarios
  for select to authenticated using ((select public.mesa_es_miembro()));
create policy mesa_comentarios_insert on public.mesa_comentarios
  for insert to authenticated with check ((select public.mesa_es_miembro()));

-- Tiempo real entre dispositivos
alter publication supabase_realtime add table public.mesa_pedidos, public.mesa_comentarios;

-- Equipo inicial (los emails del equipo de diseño se completan después)
insert into public.mesa_miembros (alias, nombre, email, es_disenador) values
  ('Naza', 'Nazareno Devia', null, true),
  ('Agus', 'Agustín Monteverdi', null, true),
  ('Bauti', 'Bautista Valle', null, true),
  ('Kevin', 'Kevin Gimenez', 'kevingimenez9705@gmail.com', false);
