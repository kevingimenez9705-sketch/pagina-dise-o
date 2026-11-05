-- Mesa de Diseño v2: acceso con clave (Naza / Miembro), sin email ni Supabase Auth.
-- Las tablas no se leen directo: todo pasa por funciones que validan la clave.
-- Las claves se cargan aparte (no en este archivo), guardadas con hash bcrypt.

-- Limpieza de la versión con login por email (no tenía datos)
drop table if exists public.mesa_comentarios, public.mesa_pedidos, public.mesa_miembros cascade;
drop function if exists public.mesa_pedidos_before_write();
drop function if exists public.mesa_comentarios_before_insert();
drop function if exists public.mesa_es_miembro();
drop function if exists public.mesa_mi_alias();

-- ---------- Tablas ----------

create table public.mesa_accesos (
  rol text primary key check (rol in ('naza', 'miembro')),
  clave_hash text not null,
  updated_at timestamptz not null default now()
);

create table public.mesa_pedidos (
  id bigint generated always as identity primary key,
  titulo text not null check (char_length(btrim(titulo)) between 1 and 160),
  marca text not null check (char_length(marca) between 1 and 80),
  area text not null check (char_length(area) between 1 and 80),
  tipo text not null check (char_length(tipo) between 1 and 60),
  prioridad text not null default 'Media'
    check (prioridad in ('Baja', 'Media', 'Alta', 'Urgente')),
  disenador text check (disenador in ('Naza', 'Agus', 'Bauti')),
  entrega date,
  estado text not null default 'Nuevas'
    check (estado in ('Nuevas', 'En progreso', 'En revisión', 'Con cambios', 'Aprobadas', 'Entregadas')),
  impresion boolean not null default false,
  link text check (link is null or (link ~* '^https?://' and char_length(link) <= 500)),
  descripcion text check (descripcion is null or char_length(descripcion) <= 4000),
  creado_por text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mesa_comentarios (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.mesa_pedidos(id) on delete cascade,
  autor text not null,
  texto text not null check (char_length(btrim(texto)) between 1 and 1000),
  sistema boolean not null default false,
  created_at timestamptz not null default now()
);

create index mesa_comentarios_pedido_idx on public.mesa_comentarios (pedido_id);

-- Sin acceso directo desde la API: solo a través de las funciones de abajo
alter table public.mesa_accesos enable row level security;
alter table public.mesa_pedidos enable row level security;
alter table public.mesa_comentarios enable row level security;
revoke all on public.mesa_accesos, public.mesa_pedidos, public.mesa_comentarios from anon, authenticated;

-- ---------- Ayudantes internos (no expuestos) ----------

create or replace function public.mesa_rol_de(p_clave text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.rol
  from public.mesa_accesos a
  where p_clave is not null
    and a.clave_hash = extensions.crypt(p_clave, a.clave_hash)
  limit 1
$$;

create or replace function public.mesa_requerir(p_clave text, p_solo_naza boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rol text := public.mesa_rol_de(p_clave);
begin
  if v_rol is null then
    raise exception 'Clave inválida' using errcode = '28000';
  end if;
  if p_solo_naza and v_rol <> 'naza' then
    raise exception 'Solo Diseño puede hacer este cambio' using errcode = '42501';
  end if;
  return v_rol;
end
$$;

create or replace function public.mesa_firma(p_rol text, p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rol = 'naza' then 'Naza'
    else coalesce(nullif(left(btrim(coalesce(p_nombre, '')), 40), ''), 'Miembro')
  end
$$;

revoke execute on function public.mesa_rol_de(text) from public, anon, authenticated;
revoke execute on function public.mesa_requerir(text, boolean) from public, anon, authenticated;
revoke execute on function public.mesa_firma(text, text) from public, anon, authenticated;

-- ---------- Funciones de la app ----------

-- Devuelve 'naza', 'miembro' o null. Con clave incorrecta demora para frenar intentos.
create or replace function public.mesa_ingresar(p_clave text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rol text := public.mesa_rol_de(p_clave);
begin
  if v_rol is null then
    perform pg_sleep(0.8);
  end if;
  return v_rol;
end
$$;

create or replace function public.mesa_datos(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.mesa_requerir(p_clave);
  return jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.mesa_pedidos p), '[]'::jsonb),
    'comentarios', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at, c.id) from public.mesa_comentarios c), '[]'::jsonb)
  );
end
$$;

create or replace function public.mesa_crear_pedido(p_clave text, p_nombre text, p_pedido jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text := public.mesa_requerir(p_clave);
  v_firma text := public.mesa_firma(v_rol, p_nombre);
  v_id bigint;
begin
  insert into public.mesa_pedidos
    (titulo, marca, area, tipo, prioridad, disenador, entrega, impresion, link, descripcion, creado_por)
  values (
    btrim(p_pedido ->> 'titulo'),
    p_pedido ->> 'marca',
    p_pedido ->> 'area',
    p_pedido ->> 'tipo',
    coalesce(p_pedido ->> 'prioridad', 'Media'),
    case when v_rol = 'naza' then nullif(p_pedido ->> 'disenador', '') end,
    nullif(p_pedido ->> 'entrega', '')::date,
    coalesce((p_pedido ->> 'impresion')::boolean, false),
    nullif(btrim(coalesce(p_pedido ->> 'link', '')), ''),
    nullif(btrim(coalesce(p_pedido ->> 'descripcion', '')), ''),
    v_firma
  )
  returning id into v_id;

  insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
  values (v_id, v_firma, 'Creó la solicitud.', true);

  return v_id;
end
$$;

create or replace function public.mesa_mover(p_clave text, p_id bigint, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
begin
  perform public.mesa_requerir(p_clave, true);
  select estado into v_prev from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  if v_prev is distinct from p_estado then
    update public.mesa_pedidos set estado = p_estado, updated_at = now() where id = p_id;
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    values (p_id, 'Naza', format('Movió el pedido a «%s».', p_estado), true);
  end if;
end
$$;

create or replace function public.mesa_asignar(p_clave text, p_id bigint, p_disenador text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nuevo text := nullif(p_disenador, '');
  v_prev text;
begin
  perform public.mesa_requerir(p_clave, true);
  select disenador into v_prev from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  if v_prev is distinct from v_nuevo then
    update public.mesa_pedidos set disenador = v_nuevo, updated_at = now() where id = p_id;
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    values (p_id, 'Naza', case when v_nuevo is null then 'Dejó el pedido sin asignar.' else format('Asignó el pedido a %s.', v_nuevo) end, true);
  end if;
end
$$;

create or replace function public.mesa_comentar(p_clave text, p_nombre text, p_id bigint, p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text := public.mesa_requerir(p_clave);
begin
  insert into public.mesa_comentarios (pedido_id, autor, texto)
  values (p_id, public.mesa_firma(v_rol, p_nombre), btrim(p_texto));
end
$$;

create or replace function public.mesa_eliminar(p_clave text, p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.mesa_requerir(p_clave, true);
  delete from public.mesa_pedidos where id = p_id;
end
$$;

revoke execute on function public.mesa_ingresar(text) from public;
revoke execute on function public.mesa_datos(text) from public;
revoke execute on function public.mesa_crear_pedido(text, text, jsonb) from public;
revoke execute on function public.mesa_mover(text, bigint, text) from public;
revoke execute on function public.mesa_asignar(text, bigint, text) from public;
revoke execute on function public.mesa_comentar(text, text, bigint, text) from public;
revoke execute on function public.mesa_eliminar(text, bigint) from public;

grant execute on function public.mesa_ingresar(text) to anon, authenticated;
grant execute on function public.mesa_datos(text) to anon, authenticated;
grant execute on function public.mesa_crear_pedido(text, text, jsonb) to anon, authenticated;
grant execute on function public.mesa_mover(text, bigint, text) to anon, authenticated;
grant execute on function public.mesa_asignar(text, bigint, text) to anon, authenticated;
grant execute on function public.mesa_comentar(text, text, bigint, text) to anon, authenticated;
grant execute on function public.mesa_eliminar(text, bigint) to anon, authenticated;

-- ---------- Aviso en vivo ----------
-- Solo avisa "hubo un cambio" (sin datos); cada pantalla vuelve a pedir los datos con su clave.

create or replace function public.mesa_avisar_cambio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('tabla', tg_table_name, 'op', tg_op), 'cambio', 'mesa-diseno', false);
  exception when others then
    raise warning 'mesa_avisar_cambio: %', sqlerrm;
  end;
  return null;
end
$$;

revoke execute on function public.mesa_avisar_cambio() from public, anon, authenticated;

create trigger mesa_pedidos_aviso
after insert or update or delete on public.mesa_pedidos
for each statement execute function public.mesa_avisar_cambio();

create trigger mesa_comentarios_aviso
after insert on public.mesa_comentarios
for each statement execute function public.mesa_avisar_cambio();
