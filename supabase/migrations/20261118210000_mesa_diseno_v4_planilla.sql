-- Mesa de Diseño v4 (spec v2.2 «Entregable final unificado»):
--  · Estados de la planilla de seguimiento: No iniciado → En proceso → Falta info → Requiere modificación → Terminado → Finalizado.
--  · Prioridad «A definir» (la define Diseño; es la de todo pedido nuevo de un área).
--  · Trabajo en conjunto «x 2» (aparece en la mesa de todo Diseño).
--  · Contador de modificaciones y observaciones: privados de Diseño (las áreas no los reciben).
--  · Link al archivo final, fecha de inicio y de finalización.
--  · Código DIS estable = «ID fijo» de la planilla; los pedidos web siguen desde 301.
--  · Naza como líder. Edición rápida (estado, prioridad, asignado, modificaciones…).
--  · Borrado: Diseño cualquier pedido; un área solo los suyos en «No iniciado».
--  · Importación de la planilla (solo agrega filas que no estén cargadas).
--  · Se borran las funciones y la tabla de claves de la v2, que ya no usa la página.

-- ---------- Ayudantes ----------

create or replace function public.mesa_hoy()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

create or replace function public.mesa_fecha(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or btrim(p) !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return left(btrim(p), 10)::date;
exception when others then
  return null;
end
$$;

revoke execute on function public.mesa_hoy() from public, anon, authenticated;
revoke execute on function public.mesa_fecha(text) from public, anon, authenticated;

-- ---------- Perfiles: líder ----------

alter table public.mesa_disenadores add column lider boolean not null default false;
update public.mesa_disenadores set lider = true where alias = 'Naza';

-- ---------- Pedidos ----------

alter table public.mesa_pedidos drop constraint mesa_pedidos_estado_check;
alter table public.mesa_pedidos drop constraint mesa_pedidos_prioridad_check;

update public.mesa_pedidos set estado = case estado
  when 'Nuevas' then 'No iniciado'
  when 'En progreso' then 'En proceso'
  when 'En revisión' then 'Terminado'
  when 'Con cambios' then 'Requiere modificación'
  when 'Aprobadas' then 'Finalizado'
  when 'Entregadas' then 'Finalizado'
  else estado
end;

alter table public.mesa_pedidos
  alter column estado set default 'No iniciado',
  alter column prioridad set default 'A definir',
  add constraint mesa_pedidos_estado_check
    check (estado in ('No iniciado', 'En proceso', 'Falta info', 'Requiere modificación', 'Terminado', 'Finalizado')),
  add constraint mesa_pedidos_prioridad_check
    check (prioridad in ('A definir', 'Urgente', 'Alta', 'Media', 'Baja')),
  add column conjunto boolean not null default false,
  add column modificaciones integer not null default 0 check (modificaciones between 0 and 999),
  add column observaciones text check (observaciones is null or char_length(observaciones) <= 4000),
  add column link_final text check (link_final is null or (link_final ~* '^https?://' and char_length(link_final) <= 500)),
  add column fecha_inicio date,
  add column fecha_fin date,
  add column origen text not null default 'web' check (origen in ('web', 'planilla')),
  add column codigo integer;

alter table public.mesa_pedidos
  add constraint mesa_pedidos_conjunto_check check (not (conjunto and disenador is not null));

update public.mesa_pedidos
set modificaciones = case when estado = 'Requiere modificación' then 1 else 0 end,
    fecha_inicio = (created_at at time zone 'America/Argentina/Buenos_Aires')::date,
    fecha_fin = case when estado = 'Finalizado' then (updated_at at time zone 'America/Argentina/Buenos_Aires')::date end;

-- Código DIS: la planilla usa 1–300; los pedidos cargados en la web pasan a 301 en adelante
create sequence public.mesa_pedidos_codigo_seq start 301;
update public.mesa_pedidos p
set codigo = 300 + r.n
from (select id, row_number() over (order by id) as n from public.mesa_pedidos) r
where r.id = p.id;
select setval('public.mesa_pedidos_codigo_seq', greatest(300, coalesce((select max(codigo) from public.mesa_pedidos), 300)));

alter table public.mesa_pedidos
  alter column codigo set default nextval('public.mesa_pedidos_codigo_seq'),
  alter column codigo set not null,
  add constraint mesa_pedidos_codigo_key unique (codigo);
alter sequence public.mesa_pedidos_codigo_seq owned by public.mesa_pedidos.codigo;
revoke all on sequence public.mesa_pedidos_codigo_seq from anon, authenticated;

create index mesa_pedidos_origen_titulo_idx on public.mesa_pedidos (origen, lower(btrim(titulo)));

-- ---------- Resumen de administración: pedidos web sin área ----------

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
        'lider', d.lider,
        'tiene_clave', d.clave_hash is not null,
        'clave_actualizada', d.clave_actualizada,
        'activos', (select count(*) from public.mesa_pedidos p
                    where (p.disenador = d.alias or p.conjunto) and p.estado <> 'Finalizado')
      ) order by d.orden, d.alias)
      from public.mesa_disenadores d where d.activo), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'nombre', a.nombre,
        'tiene_clave', a.clave_hash is not null,
        'clave_actualizada', a.clave_actualizada,
        'activos', (select count(*) from public.mesa_pedidos p where p.area_id = a.id and p.estado <> 'Finalizado'),
        'total', (select count(*) from public.mesa_pedidos p where p.area_id = a.id)
      ) order by a.nombre)
      from public.mesa_areas a where a.activo), '[]'::jsonb),
    'sin_area', (select count(*) from public.mesa_pedidos p
                 where p.area_id is null and p.origen = 'web' and p.area <> 'Diseño (interno)')
  )
$$;

revoke execute on function public.mesa_admin_resumen() from public, anon, authenticated;

-- ---------- Tablero ----------
-- Diseño ve todo; un área ve solo sus pedidos y sin los campos privados de Diseño.

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
    coalesce(jsonb_agg(
      (case when v_diseno then to_jsonb(p) else to_jsonb(p) - 'modificaciones' - 'observaciones' end)
        - 'created_at' - 'updated_at' - 'impresion'
        || jsonb_build_object('area', coalesce(a.nombre, p.area))
      order by p.codigo), '[]'::jsonb),
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
      'lider', coalesce((select d.lider from public.mesa_disenadores d where d.alias = s.disenador), false),
      'area_id', s.area_id,
      'area', (select a.nombre from public.mesa_areas a where a.id = s.area_id)),
    'hoy', public.mesa_hoy(),
    'disenadores', coalesce((
      select jsonb_agg(jsonb_build_object('alias', d.alias, 'nombre', d.nombre, 'orden', d.orden, 'lider', d.lider)
        order by d.orden, d.alias)
      from public.mesa_disenadores d where d.activo), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.nombre)
      from public.mesa_areas a where a.activo and (v_diseno or a.id = s.area_id)), '[]'::jsonb),
    'pedidos', v_pedidos,
    'comentarios', coalesce((
      select jsonb_agg(jsonb_build_object('pedido_id', c.pedido_id, 'autor', c.autor, 'texto', c.texto,
                                          'sistema', c.sistema, 'created_at', c.created_at)
        order by c.created_at, c.id)
      from public.mesa_comentarios c where c.pedido_id = any (v_ids)), '[]'::jsonb),
    'admin', case when v_diseno then public.mesa_admin_resumen() end
  );
end
$$;

-- ---------- Crear ----------
-- Un área: entra «No iniciado», «Sin asignar», prioridad «A definir», en su área.
-- Diseño (nuevo proyecto): elige área, asignado (alias o «x 2») y prioridad.

drop function public.mesa_pedido_crear(text, jsonb);

create function public.mesa_pedido_crear(p_token text, p_pedido jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token);
  v_area_id bigint;
  v_area text;
  v_asig text;
  v_dis text;
  v_conj boolean := false;
  v_prio text := 'A definir';
  v_id bigint;
  v_codigo integer;
begin
  if s.tipo = 'area' then
    v_area_id := s.area_id;
  else
    if coalesce(p_pedido ->> 'area_id', '') ~ '^[1-9][0-9]{0,17}$' then
      v_area_id := (p_pedido ->> 'area_id')::bigint;
    end if;
    v_asig := nullif(btrim(coalesce(p_pedido ->> 'asignado', '')), '');
    if v_asig in ('x 2', 'x2') then
      v_conj := true;
    elsif v_asig is not null then
      select d.alias into v_dis from public.mesa_disenadores d where d.alias = v_asig and d.activo;
      if v_dis is null then
        raise exception 'Ese perfil de Diseño ya no existe.';
      end if;
    end if;
    v_prio := coalesce(nullif(p_pedido ->> 'prioridad', ''), 'A definir');
    if v_prio not in ('A definir', 'Urgente', 'Alta', 'Media', 'Baja') then
      raise exception 'Prioridad desconocida.';
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
    (titulo, marca, area, area_id, tipo, prioridad, disenador, conjunto, entrega, estado,
     link, descripcion, creado_por, fecha_inicio, origen)
  values (
    btrim(p_pedido ->> 'titulo'),
    btrim(p_pedido ->> 'marca'),
    v_area,
    v_area_id,
    btrim(p_pedido ->> 'tipo'),
    v_prio,
    v_dis,
    v_conj,
    nullif(p_pedido ->> 'entrega', '')::date,
    'No iniciado',
    nullif(btrim(coalesce(p_pedido ->> 'link', '')), ''),
    nullif(btrim(coalesce(p_pedido ->> 'descripcion', '')), ''),
    s.nombre,
    public.mesa_hoy(),
    'web'
  )
  returning id, codigo into v_id, v_codigo;

  insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
  values (v_id, s.nombre, case when s.tipo = 'area' then 'Envió la solicitud.' else 'Cargó el proyecto.' end, true);

  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end
$$;

-- ---------- Editar (solo Diseño) ----------
-- p_cambios admite: estado, prioridad, asignado (alias, «x 2» o vacío), modificaciones, link_final, observaciones.
-- Al pasar a «Requiere modificación» suma una modificación (salvo que el cambio ya la indique).
-- Los cambios visibles quedan en el historial; las modificaciones y observaciones no (son privadas).

create or replace function public.mesa_pedido_editar(p_token text, p_id bigint, p_cambios jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
  p public.mesa_pedidos;
  v_estado text;
  v_prio text;
  v_asig text;
  v_dis text;
  v_conj boolean;
  v_mods integer;
  v_link text;
  v_obs text;
  v_log text[] := '{}';
begin
  select * into p from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido ya no existe.' using errcode = 'P0002';
  end if;

  v_estado := p.estado;
  v_prio := p.prioridad;
  v_dis := p.disenador;
  v_conj := p.conjunto;
  v_mods := p.modificaciones;
  v_link := p.link_final;
  v_obs := p.observaciones;

  if p_cambios ? 'estado' then
    v_estado := p_cambios ->> 'estado';
    if v_estado is null or v_estado not in ('No iniciado', 'En proceso', 'Falta info', 'Requiere modificación', 'Terminado', 'Finalizado') then
      raise exception 'Estado desconocido.';
    end if;
    if v_estado is distinct from p.estado then
      v_log := v_log || format('Movió el pedido a «%s».', v_estado);
      if v_estado = 'Requiere modificación' and not (p_cambios ? 'modificaciones') then
        v_mods := v_mods + 1;
      end if;
    end if;
  end if;

  if p_cambios ? 'prioridad' then
    v_prio := p_cambios ->> 'prioridad';
    if v_prio is null or v_prio not in ('A definir', 'Urgente', 'Alta', 'Media', 'Baja') then
      raise exception 'Prioridad desconocida.';
    end if;
    if v_prio is distinct from p.prioridad then
      v_log := v_log || format('Cambió la prioridad a «%s».', v_prio);
    end if;
  end if;

  if p_cambios ? 'asignado' then
    v_asig := nullif(btrim(coalesce(p_cambios ->> 'asignado', '')), '');
    if v_asig in ('x 2', 'x2') then
      v_dis := null;
      v_conj := true;
    elsif v_asig is null then
      v_dis := null;
      v_conj := false;
    else
      select d.alias into v_dis from public.mesa_disenadores d where d.alias = v_asig and d.activo;
      if v_dis is null then
        raise exception 'Ese perfil de Diseño ya no existe.';
      end if;
      v_conj := false;
    end if;
    if v_dis is distinct from p.disenador or v_conj is distinct from p.conjunto then
      v_log := v_log || case
        when v_conj then 'Lo marcó como trabajo en conjunto (x 2).'
        when v_dis is null then 'Dejó el pedido sin asignar.'
        when v_dis = s.disenador then 'Tomó el pedido para su mesa.'
        else format('Pasó el pedido a la mesa de %s.', v_dis)
      end;
    end if;
  end if;

  if p_cambios ? 'modificaciones' then
    v_mods := greatest(0, least(999, coalesce((p_cambios ->> 'modificaciones')::integer, 0)));
  end if;

  if p_cambios ? 'link_final' then
    v_link := nullif(btrim(coalesce(p_cambios ->> 'link_final', '')), '');
    if v_link is not null and v_link !~* '^https?://' then
      raise exception 'El link al archivo final tiene que empezar con http:// o https://.';
    end if;
    if v_link is distinct from p.link_final then
      v_log := v_log || case when v_link is null then 'Quitó el link al archivo final.' else 'Cargó el link al archivo final.' end;
    end if;
  end if;

  if p_cambios ? 'observaciones' then
    v_obs := nullif(btrim(coalesce(p_cambios ->> 'observaciones', '')), '');
  end if;

  update public.mesa_pedidos
  set estado = v_estado,
      prioridad = v_prio,
      disenador = v_dis,
      conjunto = v_conj,
      modificaciones = v_mods,
      link_final = v_link,
      observaciones = v_obs,
      fecha_inicio = case
        when fecha_inicio is null and v_estado <> 'No iniciado' then public.mesa_hoy()
        else fecha_inicio end,
      fecha_fin = case
        when v_estado = p.estado then fecha_fin
        when v_estado = 'Finalizado' then coalesce(fecha_fin, public.mesa_hoy())
        when p.estado = 'Finalizado' then null
        else fecha_fin end,
      updated_at = now()
  where id = p_id;

  if array_length(v_log, 1) > 0 then
    insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
    select p_id, s.nombre, t, true from unnest(v_log) as t;
  end if;
end
$$;

-- Atajos que usa el arrastre entre columnas y «Pasar a mi mesa»
create or replace function public.mesa_pedido_mover(p_token text, p_id bigint, p_estado text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.mesa_pedido_editar(p_token, p_id, jsonb_build_object('estado', p_estado));
end
$$;

create or replace function public.mesa_pedido_asignar(p_token text, p_id bigint, p_disenador text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.mesa_pedido_editar(p_token, p_id, jsonb_build_object('asignado', coalesce(p_disenador, '')));
end
$$;

-- ---------- Eliminar ----------

create or replace function public.mesa_pedido_eliminar(p_token text, p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token);
  v_area bigint;
  v_estado text;
begin
  select area_id, estado into v_area, v_estado from public.mesa_pedidos where id = p_id for update;
  if not found then
    raise exception 'El pedido ya no existe.' using errcode = 'P0002';
  end if;
  if s.tipo = 'area' then
    if v_area is distinct from s.area_id then
      raise exception 'El pedido ya no existe.' using errcode = 'P0002';
    end if;
    if v_estado <> 'No iniciado' then
      raise exception 'Solo podés eliminar pedidos que Diseño todavía no empezó.';
    end if;
  end if;
  delete from public.mesa_pedidos where id = p_id;
end
$$;

-- ---------- Importar la planilla «Seguimiento de diseños pendientes» ----------
-- Recibe las filas tal cual (id, tarea, marca, prioridad, estado, nombre, inicio, fin, modificacion,
-- observaciones, solicitud, solicitado_por, objetivo) y agrega solo las que no estén cargadas.
-- Una fila ya cargada se reconoce por su ID fijo o, si el ID está repetido, por título y fecha de inicio.

create or replace function public.mesa_importar_filas(p_filas jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v jsonb;
  v_titulo text;
  v_codigo integer;
  v_primero boolean;
  v_vistos integer[] := '{}';
  v_asignados integer[] := '{}';
  v_target bigint;
  v_m text;
  v_t text;
  v_a text;
  v_estado text;
  v_dis text;
  v_inicio date;
  v_nuevas jsonb := '[]'::jsonb;
  v_existentes integer := 0;
  v_n integer;
begin
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 3000 then
    raise exception 'El archivo no tiene el formato esperado.';
  end if;

  for r in select x.val from jsonb_array_elements(p_filas) with ordinality as x(val, ord) order by x.ord loop
    v := r.val;
    v_titulo := left(btrim(coalesce(v ->> 'tarea', '')), 160);
    continue when v_titulo = '';

    v_codigo := case when coalesce(v ->> 'id', '') ~ '^\s*[0-9]{1,6}(\.0+)?\s*$'
                     then floor((v ->> 'id')::numeric)::integer end;
    v_primero := v_codigo is not null and not (v_codigo = any (v_vistos));
    v_inicio := coalesce(public.mesa_fecha(v ->> 'inicio'), public.mesa_fecha(v ->> 'solicitud'));

    v_target := null;
    if v_primero then
      select id into v_target from public.mesa_pedidos where codigo = v_codigo and origen = 'planilla';
    end if;
    if v_target is null then
      select id into v_target from public.mesa_pedidos
      where origen = 'planilla' and lower(btrim(titulo)) = lower(v_titulo)
        and fecha_inicio is not distinct from v_inicio
      limit 1;
    end if;
    if v_codigo is not null then
      v_vistos := v_vistos || v_codigo;
    end if;
    if v_target is not null then
      v_existentes := v_existentes + 1;
      continue;
    end if;

    -- Código: el ID fijo si está libre; si no, el siguiente disponible
    if not (v_primero and not (v_codigo = any (v_asignados))
            and not exists (select 1 from public.mesa_pedidos where codigo = v_codigo)) then
      loop
        v_codigo := nextval('public.mesa_pedidos_codigo_seq');
        exit when not (v_codigo = any (v_asignados))
          and not exists (select 1 from public.mesa_pedidos where codigo = v_codigo);
      end loop;
    end if;
    v_asignados := v_asignados || v_codigo;

    v_m := translate(lower(btrim(coalesce(v ->> 'marca', ''))), 'áéíóúüñ', 'aeiouun');
    v_t := translate(lower(v_titulo), 'áéíóúüñ', 'aeiouun');
    v_a := lower(btrim(coalesce(v ->> 'nombre', '')));
    v_estado := case translate(lower(btrim(coalesce(v ->> 'estado', ''))), 'áéíóúüñ', 'aeiouun')
      when 'en proceso' then 'En proceso'
      when 'falta info' then 'Falta info'
      when 'requiere modificacion' then 'Requiere modificación'
      when 'terminado' then 'Terminado'
      when 'finalizado' then 'Finalizado'
      else 'No iniciado'
    end;
    v_dis := null;
    if v_a not in ('', 'x 2', 'x2') then
      select d.alias into v_dis from public.mesa_disenadores d where lower(d.alias) = v_a;
    end if;

    v_nuevas := v_nuevas || jsonb_build_object(
      'codigo', v_codigo,
      'titulo', v_titulo,
      'marca', case v_m
        when '' then 'Gastro (corporativo)'
        when 'corporativo / rr. hh.' then 'Gastro (corporativo)'
        when 'corporativo' then 'Gastro (corporativo)'
        when 'extremas hamburguesas' then 'Hamburguesas Extremas'
        when 'hamburguesas extremas' then 'Hamburguesas Extremas'
        when 'sabores express' then 'Sabores Express ARG.'
        when 'empanadas mania' then 'Empanadas Manía'
        when 'se/ext/m' then 'Multimarca (SE/EXT/M)'
        when 'fabricas' then 'Fábricas'
        when 'jacks' then 'Lomitos Jacks'
        else left(btrim(v ->> 'marca'), 80)
      end,
      'tipo', case
        when v_t like '%present%' then 'Presentación'
        when v_t ~ '(manual|procedimiento|protocolo)' then 'Manual'
        when v_t like '%organigrama%' then 'Organigrama'
        when v_t ~ '(capacitacion|taller|induccion|onboarding)' then 'Capacitación'
        when v_t ~ '(cartel|senaletica|senal)' then 'Señalética'
        when v_t ~ '(logo|identidad)' then 'Logo / identidad'
        else 'Pieza gráfica'
      end,
      'prioridad', case lower(btrim(coalesce(v ->> 'prioridad', '')))
        when 'urgente' then 'Urgente'
        when 'alta' then 'Alta'
        when 'media' then 'Media'
        when 'baja' then 'Baja'
        else 'A definir'
      end,
      'estado', v_estado,
      'disenador', v_dis,
      'conjunto', v_a in ('x 2', 'x2'),
      'fecha_inicio', v_inicio,
      'fecha_fin', public.mesa_fecha(v ->> 'fin'),
      'entrega', public.mesa_fecha(v ->> 'objetivo'),
      'modificaciones', greatest(
        case when public.mesa_fecha(v ->> 'modificacion') is not null then 1 else 0 end,
        case when v_estado = 'Requiere modificación' then 1 else 0 end),
      'observaciones', nullif(left(btrim(coalesce(v ->> 'observaciones', '')), 4000), ''),
      'creado_por', coalesce(nullif(left(btrim(coalesce(v ->> 'solicitado_por', '')), 40), ''), 'Planilla de seguimiento')
    );
  end loop;

  insert into public.mesa_pedidos
    (codigo, titulo, marca, area, area_id, tipo, prioridad, estado, disenador, conjunto,
     fecha_inicio, fecha_fin, entrega, modificaciones, observaciones, creado_por, origen, created_at)
  select x.codigo, x.titulo, x.marca, 'Histórico (planilla)', null, x.tipo, x.prioridad, x.estado, x.disenador, x.conjunto,
         x.fecha_inicio, x.fecha_fin, x.entrega, x.modificaciones, x.observaciones, x.creado_por, 'planilla',
         coalesce(x.fecha_inicio::timestamptz, now())
  from jsonb_to_recordset(v_nuevas) as x(
    codigo integer, titulo text, marca text, tipo text, prioridad text, estado text, disenador text, conjunto boolean,
    fecha_inicio date, fecha_fin date, entrega date, modificaciones integer, observaciones text, creado_por text);
  get diagnostics v_n = row_count;

  return jsonb_build_object('nuevos', v_n, 'existentes', v_existentes);
end
$$;

revoke execute on function public.mesa_importar_filas(jsonb) from public, anon, authenticated;

create or replace function public.mesa_importar(p_token text, p_filas jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.mesa_sesion(p_token, true);
  return public.mesa_importar_filas(p_filas);
end
$$;

-- ---------- Permisos ----------

revoke execute on function public.mesa_pedido_crear(text, jsonb) from public;
revoke execute on function public.mesa_pedido_editar(text, bigint, jsonb) from public;
revoke execute on function public.mesa_importar(text, jsonb) from public;
grant execute on function public.mesa_pedido_crear(text, jsonb) to anon, authenticated;
grant execute on function public.mesa_pedido_editar(text, bigint, jsonb) to anon, authenticated;
grant execute on function public.mesa_importar(text, jsonb) to anon, authenticated;

-- ---------- Limpieza de la v2 (clave única Naza/Miembro) ----------

drop function if exists public.mesa_ingresar(text);
drop function if exists public.mesa_datos(text);
drop function if exists public.mesa_crear_pedido(text, text, jsonb);
drop function if exists public.mesa_mover(text, bigint, text);
drop function if exists public.mesa_asignar(text, bigint, text);
drop function if exists public.mesa_comentar(text, text, bigint, text);
drop function if exists public.mesa_eliminar(text, bigint);
drop function if exists public.mesa_requerir(text, boolean);
drop function if exists public.mesa_rol_de(text);
drop function if exists public.mesa_firma(text, text);
drop table if exists public.mesa_accesos;
