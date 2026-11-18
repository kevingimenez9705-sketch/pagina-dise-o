-- Mesa de Diseño v3: mesa personal por diseñador y acceso por área solicitante.
--  · Diseño: cada integrante (Naza, Agus) entra con su perfil y su clave y tiene su propia mesa.
--  · Solicitantes: eligen su área, escriben su nombre y la clave del área; ven solo los pedidos de su área.
--  · Diseño administra perfiles, áreas y claves desde la página (Perfiles y áreas).
-- El ingreso devuelve un token de sesión; en la base se guarda solo su hash (sha256).
-- Es aditiva: mesa_accesos y las funciones de la v2 (mesa_ingresar, mesa_datos, …) siguen
-- funcionando hasta que se publique la página nueva; después se pueden borrar.

-- ---------- Tablas ----------

create table public.mesa_disenadores (
  alias text primary key check (char_length(alias) between 1 and 20 and alias = btrim(alias)),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 60),
  clave_hash text,
  clave_actualizada timestamptz,
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create unique index mesa_disenadores_alias_ci on public.mesa_disenadores (lower(alias));

create table public.mesa_areas (
  id bigint generated always as identity primary key,
  nombre text not null check (char_length(nombre) between 1 and 60 and nombre = btrim(nombre)),
  clave_hash text,
  clave_actualizada timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index mesa_areas_nombre_activa on public.mesa_areas (lower(nombre)) where activo;

create table public.mesa_sesiones (
  token_hash text primary key,
  tipo text not null check (tipo in ('diseno', 'area')),
  disenador text references public.mesa_disenadores(alias) on update cascade on delete cascade,
  area_id bigint references public.mesa_areas(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (
    (tipo = 'diseno' and disenador is not null and area_id is null)
    or (tipo = 'area' and area_id is not null and disenador is null)
  )
);
create index mesa_sesiones_disenador_idx on public.mesa_sesiones (disenador);
create index mesa_sesiones_area_idx on public.mesa_sesiones (area_id);
create index mesa_sesiones_expira_idx on public.mesa_sesiones (expires_at);

alter table public.mesa_disenadores enable row level security;
alter table public.mesa_areas enable row level security;
alter table public.mesa_sesiones enable row level security;
revoke all on public.mesa_disenadores, public.mesa_areas, public.mesa_sesiones from anon, authenticated;

-- ---------- Datos iniciales ----------
-- Naza conserva su clave actual. Agus arranca sin clave: se la pone Diseño desde «Perfiles y áreas».
-- Las áreas arrancan con la clave de «Miembro» de la v2 (marcada como heredada) hasta que Diseño la cambie.

insert into public.mesa_disenadores (alias, nombre, clave_hash, clave_actualizada, orden) values
  ('Naza', 'Nazareno Devia',
    (select a.clave_hash from public.mesa_accesos a where a.rol = 'naza'),
    (select a.updated_at from public.mesa_accesos a where a.rol = 'naza'), 0),
  ('Agus', 'Agustín Monteverdi', null, null, 1);

insert into public.mesa_areas (nombre, clave_hash)
select n, (select a.clave_hash from public.mesa_accesos a where a.rol = 'miembro')
from unnest(array['Capacitaciones', 'Desarrollo y cultura', 'Selección Operaciones', 'Selección Staff', 'Fábricas']) as n;

-- ---------- Pedidos: diseñador de la tabla de perfiles y área vinculada ----------
-- Los pedidos anteriores quedan sin área vinculada (solo los ve Diseño, que puede asignarles una).

alter table public.mesa_pedidos drop constraint mesa_pedidos_disenador_check;
alter table public.mesa_pedidos
  add constraint mesa_pedidos_disenador_fkey foreign key (disenador)
    references public.mesa_disenadores(alias) on update cascade on delete set null,
  add column area_id bigint references public.mesa_areas(id) on delete set null;
create index mesa_pedidos_area_idx on public.mesa_pedidos (area_id);
create index mesa_pedidos_disenador_idx on public.mesa_pedidos (disenador);

-- ---------- Ayudantes internos (no expuestos) ----------

create or replace function public.mesa_hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.mesa_hash_clave(p_clave text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_clave is null or char_length(btrim(p_clave)) < 4 then
    raise exception 'La clave tiene que tener al menos 4 caracteres.';
  end if;
  if char_length(btrim(p_clave)) > 60 then
    raise exception 'La clave puede tener hasta 60 caracteres.';
  end if;
  return extensions.crypt(btrim(p_clave), extensions.gen_salt('bf'));
end
$$;

-- Sesión vigente del token, o error 28000. Con p_solo_diseno exige perfil de Diseño (42501).
create or replace function public.mesa_sesion(p_token text, p_solo_diseno boolean default false)
returns public.mesa_sesiones
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones;
begin
  select * into s
  from public.mesa_sesiones
  where token_hash = public.mesa_hash_token(p_token) and expires_at > now();
  if not found then
    raise exception 'Sesión vencida o cerrada' using errcode = '28000';
  end if;
  if p_solo_diseno and s.tipo <> 'diseno' then
    raise exception 'Solo el equipo de Diseño puede hacer este cambio' using errcode = '42501';
  end if;
  return s;
end
$$;

create or replace function public.mesa_admin_resumen()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'disenadores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alias', d.alias,
        'nombre', d.nombre,
        'orden', d.orden,
        'tiene_clave', d.clave_hash is not null,
        'clave_actualizada', d.clave_actualizada,
        'activos', (select count(*) from public.mesa_pedidos p where p.disenador = d.alias and p.estado <> 'Entregadas')
      ) order by d.orden, d.alias)
      from public.mesa_disenadores d where d.activo), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'nombre', a.nombre,
        'tiene_clave', a.clave_hash is not null,
        'clave_actualizada', a.clave_actualizada,
        'activos', (select count(*) from public.mesa_pedidos p where p.area_id = a.id and p.estado <> 'Entregadas'),
        'total', (select count(*) from public.mesa_pedidos p where p.area_id = a.id)
      ) order by a.nombre)
      from public.mesa_areas a where a.activo), '[]'::jsonb),
    'sin_area', (select count(*) from public.mesa_pedidos p where p.area_id is null)
  )
$$;

revoke execute on function public.mesa_hash_token(text) from public, anon, authenticated;
revoke execute on function public.mesa_hash_clave(text) from public, anon, authenticated;
revoke execute on function public.mesa_sesion(text, boolean) from public, anon, authenticated;
revoke execute on function public.mesa_admin_resumen() from public, anon, authenticated;

-- ---------- Ingreso ----------

-- Perfiles de Diseño y áreas activas para armar la pantalla de ingreso (sin claves).
create or replace function public.mesa_opciones_ingreso()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'disenadores', coalesce((
      select jsonb_agg(jsonb_build_object('alias', d.alias, 'nombre', d.nombre, 'orden', d.orden) order by d.orden, d.alias)
      from public.mesa_disenadores d where d.activo), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.nombre)
      from public.mesa_areas a where a.activo), '[]'::jsonb)
  )
$$;

-- p_tipo 'diseno' (p_quien = alias) o 'area' (p_quien = id del área, p_nombre = quien pide).
-- Devuelve {token}, {error: 'sin_clave'} o null si la clave no corresponde (con demora).
create or replace function public.mesa_iniciar_sesion(
  p_tipo text, p_quien text, p_clave text, p_nombre text default null, p_recordar boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alias text;
  v_area bigint;
  v_hash text;
  v_existe boolean;
  v_nombre text;
  v_token text;
begin
  delete from public.mesa_sesiones where expires_at < now();

  if p_tipo = 'diseno' then
    select d.alias, d.clave_hash, true into v_alias, v_hash, v_existe
    from public.mesa_disenadores d
    where d.activo and lower(d.alias) = lower(btrim(coalesce(p_quien, '')));
    v_nombre := v_alias;
  elsif p_tipo = 'area' and coalesce(p_quien, '') ~ '^[0-9]{1,18}$' then
    select a.id, a.clave_hash, true into v_area, v_hash, v_existe
    from public.mesa_areas a
    where a.activo and a.id = p_quien::bigint;
    v_nombre := left(btrim(coalesce(p_nombre, '')), 40);
    if v_existe and v_nombre = '' then
      raise exception 'Escribí tu nombre y apellido.';
    end if;
  end if;

  if not coalesce(v_existe, false) then
    raise exception 'Ese perfil o área ya no está disponible. Recargá la página.';
  end if;
  if v_hash is null then
    return jsonb_build_object('error', 'sin_clave');
  end if;
  if p_clave is null or v_hash <> extensions.crypt(btrim(p_clave), v_hash) then
    perform pg_sleep(0.8);
    return null;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.mesa_sesiones (token_hash, tipo, disenador, area_id, nombre, expires_at)
  values (public.mesa_hash_token(v_token), p_tipo, v_alias, v_area, v_nombre,
          now() + case when coalesce(p_recordar, true) then interval '60 days' else interval '12 hours' end);
  return jsonb_build_object('token', v_token);
end
$$;

create or replace function public.mesa_cerrar_sesion(p_token text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.mesa_sesiones where token_hash = public.mesa_hash_token(p_token)
$$;

-- ---------- Tablero ----------
-- Diseño ve todos los pedidos (y el resumen de administración); un área ve solo los suyos.

create or replace function public.mesa_tablero(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token);
  v_diseno boolean := s.tipo = 'diseno';
  v_pedidos jsonb;
  v_ids bigint[];
begin
  select
    coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('area', coalesce(a.nombre, p.area)) order by p.id), '[]'::jsonb),
    coalesce(array_agg(p.id), '{}')
  into v_pedidos, v_ids
  from public.mesa_pedidos p
  left join public.mesa_areas a on a.id = p.area_id
  where v_diseno or p.area_id = s.area_id;

  return jsonb_build_object(
    'yo', jsonb_build_object(
      'tipo', s.tipo,
      'nombre', s.nombre,
      'disenador', s.disenador,
      'area_id', s.area_id,
      'area', (select a.nombre from public.mesa_areas a where a.id = s.area_id)),
    'disenadores', coalesce((
      select jsonb_agg(jsonb_build_object('alias', d.alias, 'nombre', d.nombre, 'orden', d.orden) order by d.orden, d.alias)
      from public.mesa_disenadores d where d.activo), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.nombre)
      from public.mesa_areas a where a.activo and (v_diseno or a.id = s.area_id)), '[]'::jsonb),
    'pedidos', v_pedidos,
    'comentarios', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
      from public.mesa_comentarios c where c.pedido_id = any (v_ids)), '[]'::jsonb),
    'admin', case when v_diseno then public.mesa_admin_resumen() end
  );
end
$$;

-- ---------- Pedidos ----------

create or replace function public.mesa_pedido_crear(p_token text, p_pedido jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token);
  v_area_id bigint;
  v_area text;
  v_dis text;
  v_id bigint;
begin
  if s.tipo = 'area' then
    v_area_id := s.area_id;
  else
    if coalesce(p_pedido ->> 'area_id', '') ~ '^[1-9][0-9]{0,17}$' then
      v_area_id := (p_pedido ->> 'area_id')::bigint;
    end if;
    v_dis := nullif(p_pedido ->> 'disenador', '');
    if v_dis is not null and not exists (select 1 from public.mesa_disenadores d where d.alias = v_dis and d.activo) then
      raise exception 'Ese perfil de Diseño ya no existe.';
    end if;
  end if;

  if v_area_id is null then
    v_area := 'Diseño (interno)';
  else
    select a.nombre into v_area from public.mesa_areas a where a.id = v_area_id and a.activo;
    if v_area is null then
      raise exception 'Esa área ya no existe.';
    end if;
  end if;

  insert into public.mesa_pedidos
    (titulo, marca, area, area_id, tipo, prioridad, disenador, entrega, impresion, link, descripcion, creado_por)
  values (
    btrim(p_pedido ->> 'titulo'),
    p_pedido ->> 'marca',
    v_area,
    v_area_id,
    p_pedido ->> 'tipo',
    coalesce(p_pedido ->> 'prioridad', 'Media'),
    v_dis,
    nullif(p_pedido ->> 'entrega', '')::date,
    coalesce((p_pedido ->> 'impresion')::boolean, false),
    nullif(btrim(coalesce(p_pedido ->> 'link', '')), ''),
    nullif(btrim(coalesce(p_pedido ->> 'descripcion', '')), ''),
    s.nombre
  )
  returning id into v_id;

  insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
  values (v_id, s.nombre, 'Creó la solicitud.', true);

  return v_id;
end
$$;

create or replace function public.mesa_pedido_mover(p_token text, p_id bigint, p_estado text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
  v_prev text;
begin
  select estado into v_prev from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido ya no existe.' using errcode = 'P0002';
  end if;
  if v_prev is distinct from p_estado then
    update public.mesa_pedidos set estado = p_estado, updated_at = now() where id = p_id;
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    values (p_id, s.nombre, format('Movió el pedido a «%s».', p_estado), true);
  end if;
end
$$;

create or replace function public.mesa_pedido_asignar(p_token text, p_id bigint, p_disenador text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
  v_nuevo text := nullif(p_disenador, '');
  v_prev text;
begin
  if v_nuevo is not null and not exists (select 1 from public.mesa_disenadores d where d.alias = v_nuevo and d.activo) then
    raise exception 'Ese perfil de Diseño ya no existe.';
  end if;
  select disenador into v_prev from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido ya no existe.' using errcode = 'P0002';
  end if;
  if v_prev is distinct from v_nuevo then
    update public.mesa_pedidos set disenador = v_nuevo, updated_at = now() where id = p_id;
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    values (p_id, s.nombre,
      case
        when v_nuevo is null then 'Dejó el pedido sin asignar.'
        when v_nuevo = s.disenador then 'Tomó el pedido para su mesa.'
        else format('Pasó el pedido a la mesa de %s.', v_nuevo)
      end, true);
  end if;
end
$$;

-- p_area_id null o 0 = «Diseño (interno)»
create or replace function public.mesa_pedido_area(p_token text, p_id bigint, p_area_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
  v_area_id bigint := nullif(p_area_id, 0);
  v_area text := 'Diseño (interno)';
  v_prev bigint;
begin
  if v_area_id is not null then
    select a.nombre into v_area from public.mesa_areas a where a.id = v_area_id and a.activo;
    if not found then
      raise exception 'Esa área ya no existe.';
    end if;
  end if;
  select area_id into v_prev from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido ya no existe.' using errcode = 'P0002';
  end if;
  update public.mesa_pedidos set area_id = v_area_id, area = v_area, updated_at = now() where id = p_id;
  if v_prev is distinct from v_area_id then
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    values (p_id, s.nombre, format('Pasó el pedido al área «%s».', v_area), true);
  end if;
end
$$;

create or replace function public.mesa_pedido_comentar(p_token text, p_id bigint, p_texto text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token);
begin
  if not exists (
    select 1 from public.mesa_pedidos p
    where p.id = p_id and (s.tipo = 'diseno' or p.area_id = s.area_id)
  ) then
    raise exception 'El pedido ya no existe.' using errcode = 'P0002';
  end if;
  insert into public.mesa_comentarios (pedido_id, autor, texto)
  values (p_id, s.nombre, btrim(p_texto));
end
$$;

create or replace function public.mesa_pedido_eliminar(p_token text, p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.mesa_sesion(p_token, true);
  delete from public.mesa_pedidos where id = p_id;
end
$$;

-- ---------- Administración (solo Diseño) ----------

-- p_accion: 'crear' (alias, nombre, clave) · 'clave' (alias, clave) · 'quitar' (alias)
create or replace function public.mesa_admin_disenador(
  p_token text, p_accion text, p_alias text, p_nombre text default null, p_clave text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
  v_alias text := btrim(coalesce(p_alias, ''));
  v_nombre text := coalesce(nullif(btrim(coalesce(p_nombre, '')), ''), btrim(coalesce(p_alias, '')));
  d public.mesa_disenadores;
begin
  select * into d from public.mesa_disenadores where lower(alias) = lower(v_alias);

  if p_accion = 'crear' then
    if char_length(v_alias) not between 1 and 20 then
      raise exception 'El nombre corto tiene que tener entre 1 y 20 caracteres.';
    end if;
    if char_length(v_nombre) > 60 then
      raise exception 'El nombre completo puede tener hasta 60 caracteres.';
    end if;
    if d.alias is not null and d.activo then
      raise exception 'Ya existe el perfil «%».', d.alias;
    end if;
    if d.alias is not null then
      -- Vuelve un perfil que se había quitado: conserva su historial
      update public.mesa_disenadores
      set alias = v_alias, nombre = v_nombre, clave_hash = public.mesa_hash_clave(p_clave),
          clave_actualizada = now(), activo = true,
          orden = (select coalesce(max(orden), -1) + 1 from public.mesa_disenadores)
      where alias = d.alias;
    else
      insert into public.mesa_disenadores (alias, nombre, clave_hash, clave_actualizada, orden)
      values (v_alias, v_nombre, public.mesa_hash_clave(p_clave), now(),
              (select coalesce(max(orden), -1) + 1 from public.mesa_disenadores));
    end if;
    return;
  end if;

  if d.alias is null or not d.activo then
    raise exception 'Ese perfil ya no existe.';
  end if;

  if p_accion = 'clave' then
    update public.mesa_disenadores
    set clave_hash = public.mesa_hash_clave(p_clave), clave_actualizada = now()
    where alias = d.alias;
    -- Cierra las otras sesiones abiertas con la clave anterior
    delete from public.mesa_sesiones where disenador = d.alias and token_hash <> s.token_hash;
  elsif p_accion = 'quitar' then
    if d.alias = s.disenador then
      raise exception 'No podés quitar tu propio perfil.';
    end if;
    if (select count(*) from public.mesa_disenadores where activo) <= 1 then
      raise exception 'Tiene que quedar al menos un perfil de Diseño.';
    end if;
    update public.mesa_disenadores set activo = false, clave_hash = null where alias = d.alias;
    delete from public.mesa_sesiones where disenador = d.alias;
    -- Sus pedidos abiertos vuelven a «sin asignar» para que nadie los pierda de vista
    with liberados as (
      update public.mesa_pedidos set disenador = null, updated_at = now()
      where disenador = d.alias and estado <> 'Entregadas'
      returning id
    )
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    select id, s.nombre, format('Quitó el perfil de %s: el pedido quedó sin asignar.', d.alias), true
    from liberados;
  else
    raise exception 'Acción desconocida.';
  end if;
end
$$;

-- p_accion: 'crear' (nombre, clave) · 'clave' (id, clave) · 'quitar' (id)
create or replace function public.mesa_admin_area(
  p_token text, p_accion text, p_id bigint default null, p_nombre text default null, p_clave text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
  v_nombre text := btrim(coalesce(p_nombre, ''));
  a public.mesa_areas;
begin
  if p_accion = 'crear' then
    if char_length(v_nombre) not between 1 and 60 then
      raise exception 'El nombre del área tiene que tener entre 1 y 60 caracteres.';
    end if;
    if exists (select 1 from public.mesa_areas where activo and lower(nombre) = lower(v_nombre)) then
      raise exception 'Ya existe el área «%».', v_nombre;
    end if;
    -- Si el área existió antes, vuelve con sus pedidos
    select * into a from public.mesa_areas
    where not activo and lower(nombre) = lower(v_nombre)
    order by id desc limit 1;
    if a.id is not null then
      update public.mesa_areas
      set nombre = v_nombre, clave_hash = public.mesa_hash_clave(p_clave), clave_actualizada = now(), activo = true
      where id = a.id;
    else
      insert into public.mesa_areas (nombre, clave_hash, clave_actualizada)
      values (v_nombre, public.mesa_hash_clave(p_clave), now());
    end if;
    return;
  end if;

  select * into a from public.mesa_areas where id = p_id and activo;
  if a.id is null then
    raise exception 'Esa área ya no existe.';
  end if;

  if p_accion = 'clave' then
    update public.mesa_areas
    set clave_hash = public.mesa_hash_clave(p_clave), clave_actualizada = now()
    where id = a.id;
    delete from public.mesa_sesiones where area_id = a.id;
  elsif p_accion = 'quitar' then
    update public.mesa_areas set activo = false, clave_hash = null where id = a.id;
    delete from public.mesa_sesiones where area_id = a.id;
  else
    raise exception 'Acción desconocida.';
  end if;
end
$$;

-- ---------- Permisos ----------

revoke execute on function public.mesa_opciones_ingreso() from public;
revoke execute on function public.mesa_iniciar_sesion(text, text, text, text, boolean) from public;
revoke execute on function public.mesa_cerrar_sesion(text) from public;
revoke execute on function public.mesa_tablero(text) from public;
revoke execute on function public.mesa_pedido_crear(text, jsonb) from public;
revoke execute on function public.mesa_pedido_mover(text, bigint, text) from public;
revoke execute on function public.mesa_pedido_asignar(text, bigint, text) from public;
revoke execute on function public.mesa_pedido_area(text, bigint, bigint) from public;
revoke execute on function public.mesa_pedido_comentar(text, bigint, text) from public;
revoke execute on function public.mesa_pedido_eliminar(text, bigint) from public;
revoke execute on function public.mesa_admin_disenador(text, text, text, text, text) from public;
revoke execute on function public.mesa_admin_area(text, text, bigint, text, text) from public;

grant execute on function public.mesa_opciones_ingreso() to anon, authenticated;
grant execute on function public.mesa_iniciar_sesion(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.mesa_cerrar_sesion(text) to anon, authenticated;
grant execute on function public.mesa_tablero(text) to anon, authenticated;
grant execute on function public.mesa_pedido_crear(text, jsonb) to anon, authenticated;
grant execute on function public.mesa_pedido_mover(text, bigint, text) to anon, authenticated;
grant execute on function public.mesa_pedido_asignar(text, bigint, text) to anon, authenticated;
grant execute on function public.mesa_pedido_area(text, bigint, bigint) to anon, authenticated;
grant execute on function public.mesa_pedido_comentar(text, bigint, text) to anon, authenticated;
grant execute on function public.mesa_pedido_eliminar(text, bigint) to anon, authenticated;
grant execute on function public.mesa_admin_disenador(text, text, text, text, text) to anon, authenticated;
grant execute on function public.mesa_admin_area(text, text, bigint, text, text) to anon, authenticated;

-- ---------- Aviso en vivo también al cambiar perfiles o áreas ----------

create trigger mesa_disenadores_aviso
after insert or update or delete on public.mesa_disenadores
for each statement execute function public.mesa_avisar_cambio();

create trigger mesa_areas_aviso
after insert or update or delete on public.mesa_areas
for each statement execute function public.mesa_avisar_cambio();
