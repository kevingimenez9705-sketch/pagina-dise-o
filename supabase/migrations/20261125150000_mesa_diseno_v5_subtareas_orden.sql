-- Mesa de Diseño v5: subtareas, orden manual en el tablero y edición de los datos del pedido.
-- No cambia ningún dato existente: solo agrega dos columnas (vacías) y amplía las funciones.

-- ---------- Columnas nuevas ----------
-- subtareas: lista [{t: título, p: página (opcional), l: link (opcional), ok: lista}]
-- orden: posición manual dentro de su columna del tablero (null = orden automático)

alter table public.mesa_pedidos
  add column subtareas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(subtareas) = 'array' and jsonb_array_length(subtareas) <= 60),
  add column orden integer;

-- Normaliza la lista que llega del navegador (descarta lo inválido, recorta largos)
create or replace function public.mesa_subtareas_limpiar(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.n), '[]'::jsonb)
  from (
    select n,
      jsonb_build_object(
        't', left(btrim(e ->> 't'), 200),
        'p', left(btrim(coalesce(e ->> 'p', '')), 20),
        'l', case when btrim(coalesce(e ->> 'l', '')) ~* '^https?://' then left(btrim(e ->> 'l'), 500) else '' end,
        'ok', coalesce((e ->> 'ok')::boolean, false)) as item
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)
      with ordinality as a(e, n)
    where jsonb_typeof(e) = 'object' and btrim(coalesce(e ->> 't', '')) <> ''
    order by n
    limit 60
  ) x
$$;

revoke execute on function public.mesa_subtareas_limpiar(jsonb) from public, anon, authenticated;

-- ---------- Crear: ahora acepta subtareas ----------

create or replace function public.mesa_pedido_crear(p_token text, p_pedido jsonb)
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
     link, descripcion, creado_por, fecha_inicio, origen, subtareas)
  values (
    btrim(p_pedido ->> 'titulo'),
    left(btrim(p_pedido ->> 'marca'), 80),
    v_area,
    v_area_id,
    left(btrim(p_pedido ->> 'tipo'), 60),
    v_prio,
    v_dis,
    v_conj,
    nullif(p_pedido ->> 'entrega', '')::date,
    'No iniciado',
    nullif(btrim(coalesce(p_pedido ->> 'link', '')), ''),
    nullif(btrim(coalesce(p_pedido ->> 'descripcion', '')), ''),
    s.nombre,
    public.mesa_hoy(),
    'web',
    public.mesa_subtareas_limpiar(coalesce(p_pedido -> 'subtareas', '[]'::jsonb))
  )
  returning id, codigo into v_id, v_codigo;

  insert into public.mesa_comentarios (pedido_id, autor, texto, sistema)
  values (v_id, s.nombre, case when s.tipo = 'area' then 'Envió la solicitud.' else 'Cargó el proyecto.' end, true);

  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end
$$;

-- ---------- Editar (solo Diseño) ----------
-- Además de lo de la v4, admite: titulo, marca, tipo, entrega, fecha_inicio, descripcion, link, subtareas.
-- Al cambiar de estado, la tarjeta vuelve al orden automático de su nueva columna.

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
  v_titulo text;
  v_marca text;
  v_tipo text;
  v_entrega date;
  v_inicio date;
  v_desc text;
  v_insumos text;
  v_subs jsonb;
  v_datos boolean := false;
  v_n integer;
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
  v_titulo := p.titulo;
  v_marca := p.marca;
  v_tipo := p.tipo;
  v_entrega := p.entrega;
  v_inicio := p.fecha_inicio;
  v_desc := p.descripcion;
  v_insumos := p.link;
  v_subs := p.subtareas;

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

  -- Datos del pedido
  if p_cambios ? 'titulo' then
    v_titulo := btrim(coalesce(p_cambios ->> 'titulo', ''));
    if char_length(v_titulo) not between 1 and 160 then
      raise exception 'El título tiene que tener entre 1 y 160 caracteres.';
    end if;
    if v_titulo is distinct from p.titulo then
      v_log := v_log || format('Cambió el título a «%s».', v_titulo);
    end if;
  end if;

  if p_cambios ? 'marca' then
    v_marca := left(btrim(coalesce(p_cambios ->> 'marca', '')), 80);
    if v_marca = '' then
      raise exception 'Elegí una marca o ámbito.';
    end if;
    v_datos := v_datos or v_marca is distinct from p.marca;
  end if;

  if p_cambios ? 'tipo' then
    v_tipo := left(btrim(coalesce(p_cambios ->> 'tipo', '')), 60);
    if v_tipo = '' then
      raise exception 'Elegí el tipo de pieza.';
    end if;
    v_datos := v_datos or v_tipo is distinct from p.tipo;
  end if;

  if p_cambios ? 'entrega' then
    v_entrega := nullif(p_cambios ->> 'entrega', '')::date;
    v_datos := v_datos or v_entrega is distinct from p.entrega;
  end if;

  if p_cambios ? 'fecha_inicio' then
    v_inicio := nullif(p_cambios ->> 'fecha_inicio', '')::date;
    v_datos := v_datos or v_inicio is distinct from p.fecha_inicio;
  end if;

  if p_cambios ? 'descripcion' then
    v_desc := nullif(btrim(coalesce(p_cambios ->> 'descripcion', '')), '');
    if char_length(v_desc) > 4000 then
      raise exception 'Las indicaciones son demasiado largas.';
    end if;
    v_datos := v_datos or v_desc is distinct from p.descripcion;
  end if;

  if p_cambios ? 'link' then
    v_insumos := nullif(btrim(coalesce(p_cambios ->> 'link', '')), '');
    if v_insumos is not null and v_insumos !~* '^https?://' then
      raise exception 'El link de insumos tiene que empezar con http:// o https://.';
    end if;
    v_datos := v_datos or v_insumos is distinct from p.link;
  end if;

  if v_datos then
    v_log := v_log || 'Editó los datos del pedido.'::text;
  end if;

  if p_cambios ? 'subtareas' then
    v_subs := public.mesa_subtareas_limpiar(p_cambios -> 'subtareas');
    v_n := jsonb_array_length(v_subs) - jsonb_array_length(p.subtareas);
    if v_n > 0 then
      v_log := v_log || case when v_n = 1 then 'Agregó una subtarea.' else format('Agregó %s subtareas.', v_n) end;
    end if;
    v_log := v_log || coalesce((
      select array_agg(format('Completó la subtarea «%s».', n ->> 't'))
      from jsonb_array_elements(v_subs) n
      where (n ->> 'ok')::boolean
        and not exists (
          select 1 from jsonb_array_elements(p.subtareas) o
          where o ->> 't' = n ->> 't' and (o ->> 'ok')::boolean)), '{}');
  end if;

  update public.mesa_pedidos
  set estado = v_estado,
      prioridad = v_prio,
      disenador = v_dis,
      conjunto = v_conj,
      modificaciones = v_mods,
      link_final = v_link,
      observaciones = v_obs,
      titulo = v_titulo,
      marca = v_marca,
      tipo = v_tipo,
      entrega = v_entrega,
      descripcion = v_desc,
      link = v_insumos,
      subtareas = v_subs,
      orden = case when v_estado = p.estado then orden end,
      fecha_inicio = case
        when p_cambios ? 'fecha_inicio' then v_inicio
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

-- ---------- Orden manual dentro de una columna (solo Diseño) ----------
-- Recibe los ids de la columna en el orden en que quedaron y, si viene, el estado de la columna
-- (cuando la tarjeta llegó desde otra columna, el cambio de estado se hace antes con mesa_pedido_editar).

create or replace function public.mesa_pedido_ordenar(p_token text, p_estado text, p_ids bigint[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.mesa_sesiones := public.mesa_sesion(p_token, true);
begin
  if coalesce(array_length(p_ids, 1), 0) > 5000 then
    raise exception 'Demasiadas tarjetas para ordenar.';
  end if;
  update public.mesa_pedidos p
  set orden = x.n
  from unnest(p_ids) with ordinality as x(id, n)
  where p.id = x.id and p.estado = p_estado;
end
$$;

revoke execute on function public.mesa_pedido_ordenar(text, text, bigint[]) from public;
grant execute on function public.mesa_pedido_ordenar(text, text, bigint[]) to anon, authenticated;
