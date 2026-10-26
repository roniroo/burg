import type { PGlite } from "@electric-sql/pglite";

/**
 * PostgREST, for one person, inside this process.
 *
 * Every query in the app is written against `@supabase/postgrest-js`: chains
 * like `.from("buildings").select("id, title").eq("city_id", id)`. On Supabase
 * those became HTTP requests to PostgREST, which turned them into SQL. Here the
 * client's `fetch` is pointed at `restHandler` instead, which does the same
 * translation against the local database and answers with a `Response` shaped
 * the way PostgREST's would be -- so the call sites, and the types generated
 * for them, did not have to change.
 *
 * It implements the part of PostgREST's URL grammar this codebase uses, and
 * refuses the rest loudly rather than guessing:
 *
 *   select    columns, `*`, `alias:column`, `column::type`, and embeds along a
 *             foreign key (`neighborhoods(name)`, `buildings!some_fkey(id)`)
 *   filters   eq neq gt gte lt lte like ilike is in, `not.`, `or=(...)`
 *   modifiers order, limit, offset, `.single()` (Accept: object+json),
 *             `Prefer: count=exact`, and HEAD for `{ head: true }`
 *   writes    insert (one row or many), upsert with `on_conflict` and either
 *             resolution, update, delete, `Prefer: return=representation`
 *   rpc       POST /rpc/<function> with named arguments
 *
 * Results are serialised by Postgres itself (`json_agg`), as PostgREST does
 * it, so timestamps, bigints and jsonb come back in the shape they always
 * have. Errors carry the SQLSTATE in `code`, which the app reads (`23505`,
 * `23P01`) to tell a race from a mistake.
 *
 * Values are always bound as parameters. Identifiers are checked against the
 * catalog, and against a strict pattern, before they are quoted into SQL.
 */

type Database = Pick<PGlite, "query" | "transaction">;
type Queryable = Pick<PGlite, "query">;

type ForeignKey = {
  name: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
};

type Catalog = {
  columns: Map<string, Set<string>>;
  primaryKeys: Map<string, string[]>;
  foreignKeys: ForeignKey[];
  functions: Map<string, { returnsSet: boolean; returnsRow: boolean }>;
};

class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string | null = null,
  ) {
    super(message);
  }
}

const unsupported = (what: string) =>
  new RestError(400, "PGRST100", `Burg's local PostgREST does not support ${what}`);

/* -------------------------------------------------------------------------
   Entry point
   ------------------------------------------------------------------------- */

export function restHandler(db: Database): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await route(db, await catalogFor(db), request);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function route(db: Database, catalog: Catalog, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const name = segments.at(-1) ?? "";
  if (segments.at(-2) === "rpc") return rpc(db, catalog, name, request);

  if (!catalog.columns.has(name)) {
    throw new RestError(404, "42P01", `relation "public.${name}" does not exist`);
  }

  const query = parseQuery(url.searchParams);
  const prefer = parsePrefer(request.headers);
  const single = (request.headers.get("accept") ?? "").startsWith("application/vnd.pgrst.object+json");
  const plan: Plan = { db, catalog, table: name, query, prefer, single };

  switch (request.method) {
    case "GET":
    case "HEAD":
      return read(plan, request.method === "HEAD");
    case "POST":
      return insert(plan, await body(request));
    case "PATCH":
      return update(plan, await body(request));
    case "DELETE":
      return remove(plan);
    default:
      throw new RestError(405, "PGRST117", `Unsupported HTTP method: ${request.method}`);
  }
}

type Plan = {
  db: Database;
  catalog: Catalog;
  table: string;
  query: Query;
  prefer: Prefer;
  single: boolean;
};

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  return text ? JSON.parse(text) : undefined;
}

/* -------------------------------------------------------------------------
   Catalog
   ------------------------------------------------------------------------- */

const catalogs = new WeakMap<object, Promise<Catalog>>();

/** Read once per database. The schema only changes in migrations, which run before anything asks. */
function catalogFor(db: Queryable): Promise<Catalog> {
  let catalog = catalogs.get(db);
  if (!catalog) {
    catalog = loadCatalog(db);
    catalogs.set(db, catalog);
    catalog.catch(() => catalogs.delete(db));
  }
  return catalog;
}

async function loadCatalog(db: Queryable): Promise<Catalog> {
  const columns = await db.query<{ table_name: string; column_name: string }>(`
    select c.relname as table_name, a.attname as column_name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm', 'p')
      and a.attnum > 0
      and not a.attisdropped
  `);

  const constraints = await db.query<{
    name: string;
    type: string;
    from_table: string;
    from_columns: string[];
    to_table: string | null;
    to_columns: string[];
  }>(`
    select
      con.conname as name,
      con.contype::text as type,
      src.relname as from_table,
      array(
        select a.attname::text
        from unnest(con.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
        order by k.ord
      ) as from_columns,
      dst.relname as to_table,
      array(
        select a.attname::text
        from unnest(con.confkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum
        order by k.ord
      ) as to_columns
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_namespace n on n.oid = src.relnamespace
    left join pg_class dst on dst.oid = con.confrelid
    where n.nspname = 'public' and con.contype in ('p', 'f')
  `);

  const functions = await db.query<{ name: string; returns_set: boolean; returns_row: boolean }>(`
    select
      p.proname as name,
      p.proretset as returns_set,
      (t.typtype = 'c' or p.prorettype = 'record'::regtype) as returns_row
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f'
  `);

  const catalog: Catalog = {
    columns: new Map(),
    primaryKeys: new Map(),
    foreignKeys: [],
    functions: new Map(),
  };
  for (const { table_name, column_name } of columns.rows) {
    const set = catalog.columns.get(table_name) ?? new Set<string>();
    set.add(column_name);
    catalog.columns.set(table_name, set);
  }
  for (const c of constraints.rows) {
    if (c.type === "p") catalog.primaryKeys.set(c.from_table, c.from_columns);
    // A key into another schema (auth.users) is not something a query here can embed.
    else if (c.to_table && catalog.columns.has(c.to_table)) {
      catalog.foreignKeys.push({
        name: c.name,
        fromTable: c.from_table,
        fromColumns: c.from_columns,
        toTable: c.to_table,
        toColumns: c.to_columns,
      });
    }
  }
  for (const f of functions.rows) {
    catalog.functions.set(f.name, { returnsSet: f.returns_set, returnsRow: f.returns_row });
  }
  return catalog;
}

/** Two leading underscores are kept for this module's own row aliases; see `aggregate`. */
const IDENTIFIER = /^(?!__)[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw unsupported(`the identifier "${name}"`);
  return `"${name}"`;
}

function column(catalog: Catalog, table: string, name: string): string {
  if (!catalog.columns.get(table)?.has(name)) {
    throw new RestError(400, "42703", `column ${table}.${name} does not exist`);
  }
  return ident(name);
}

/* -------------------------------------------------------------------------
   Parsing the request
   ------------------------------------------------------------------------- */

type SelectItem =
  | { kind: "star" }
  | { kind: "column"; name: string; alias?: string; cast?: string }
  | { kind: "embed"; name: string; alias?: string; hint?: string; items: SelectItem[] };

type Condition = { kind: "condition"; column: string; negate: boolean; op: string; value: string };
type Group = { kind: "group"; join: "and" | "or"; negate: boolean; filters: Filter[] };
type Filter = Condition | Group;

type Order = { column: string; direction: "asc" | "desc"; nulls?: "first" | "last" };

type Query = {
  select: SelectItem[];
  filters: Filter[];
  order: Order[];
  limit?: number;
  offset: number;
  onConflict?: string[];
};

type Prefer = {
  representation: boolean;
  count: boolean;
  resolution: "merge" | "ignore" | null;
};

/** Query-string keys that are not column filters. */
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseQuery(params: URLSearchParams): Query {
  const filters: Filter[] = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and" || key === "not.or" || key === "not.and") {
      filters.push(parseGroup(key, value));
    } else {
      filters.push(parseCondition(key, value));
    }
  }

  const limit = params.get("limit");
  const offset = params.get("offset");
  const onConflict = params.get("on_conflict");

  return {
    select: parseSelect(params.get("select") ?? "*"),
    filters,
    order: parseOrder(params.get("order")),
    limit: limit === null ? undefined : integer(limit, "limit"),
    offset: offset === null ? 0 : integer(offset, "offset"),
    onConflict: onConflict ? onConflict.split(",") : undefined,
  };
}

function integer(text: string, what: string): number {
  if (!/^\d+$/.test(text)) throw new RestError(400, "PGRST100", `"${text}" is not a valid ${what}`);
  return Number(text);
}

function parsePrefer(headers: Headers): Prefer {
  const tokens = (headers.get("prefer") ?? "").split(/[,\s]+/).filter(Boolean);
  const value = (key: string) => tokens.find((t) => t.startsWith(`${key}=`))?.slice(key.length + 1);
  const resolution = value("resolution");
  return {
    representation: value("return") === "representation",
    count: value("count") !== undefined,
    resolution:
      resolution === "merge-duplicates" ? "merge" : resolution === "ignore-duplicates" ? "ignore" : null,
  };
}

/** Split on commas that are not inside parentheses or double quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") quoted = !quoted;
    else if (quoted) continue;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((p) => p.length > 0);
}

function unquote(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replace(/\\"/g, '"')
    : text;
}

const ALIASED = /^([A-Za-z_][A-Za-z0-9_]*):(?!:)(.*)$/;

function parseSelect(text: string): SelectItem[] {
  return splitTopLevel(text).map((part): SelectItem => {
    if (part === "*") return { kind: "star" };

    const aliased = ALIASED.exec(part);
    const alias = aliased?.[1];
    const rest = aliased ? (aliased[2] ?? "") : part;

    const open = rest.indexOf("(");
    if (open !== -1) {
      if (!rest.endsWith(")")) throw unsupported(`the select "${part}"`);
      const [name = "", ...hints] = rest.slice(0, open).split("!");
      // `!inner` and `!left` change how a parent row is filtered by its embed;
      // nothing here uses them, so they are refused rather than ignored.
      if (hints.some((h) => h === "inner" || h === "left")) throw unsupported(`"!${hints.join("!")}"`);
      if (hints.length > 1) throw unsupported(`the select "${part}"`);
      return { kind: "embed", name, alias, hint: hints[0], items: parseSelect(rest.slice(open + 1, -1)) };
    }

    if (rest.includes("->") || rest.startsWith("...")) throw unsupported(`the select "${part}"`);
    const [name = "", cast] = rest.split("::");
    if (cast !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*(\[\])?$/.test(cast)) {
      throw unsupported(`the cast "${cast}"`);
    }
    return { kind: "column", name, alias, cast };
  });
}

function parseCondition(column: string, expression: string): Condition {
  let rest = expression;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot === -1) throw new RestError(400, "PGRST100", `"${expression}" is not a filter`);
  return { kind: "condition", column, negate, op: rest.slice(0, dot), value: rest.slice(dot + 1) };
}

/** `or=(a.eq.1,b.is.null)`, possibly nesting `and(...)` and `not.or(...)`. */
function parseGroup(key: string, value: string): Group {
  const negate = key.startsWith("not.");
  const join = key.endsWith("or") ? "or" : "and";
  if (!value.startsWith("(") || !value.endsWith(")")) {
    throw new RestError(400, "PGRST100", `"${value}" is not a logic tree`);
  }
  const filters = splitTopLevel(value.slice(1, -1)).map((term): Filter => {
    const nested = /^(not\.)?(and|or)(\(.*\))$/.exec(term);
    if (nested) return parseGroup(`${nested[1] ?? ""}${nested[2]}`, nested[3] ?? "");
    const dot = term.indexOf(".");
    if (dot === -1) throw new RestError(400, "PGRST100", `"${term}" is not a filter`);
    const condition = parseCondition(term.slice(0, dot), term.slice(dot + 1));
    return { ...condition, value: unquote(condition.value) };
  });
  return { kind: "group", join, negate, filters };
}

function parseOrder(text: string | null): Order[] {
  if (!text) return [];
  return text.split(",").map((term) => {
    const [name = "", ...modifiers] = term.split(".");
    const order: Order = { column: name, direction: "asc" };
    for (const m of modifiers) {
      if (m === "asc" || m === "desc") order.direction = m;
      else if (m === "nullsfirst") order.nulls = "first";
      else if (m === "nullslast") order.nulls = "last";
      else throw unsupported(`the ordering "${term}"`);
    }
    return order;
  });
}

/* -------------------------------------------------------------------------
   Building SQL
   ------------------------------------------------------------------------- */

class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

type Context = { catalog: Catalog; params: Params; aliases: number };

const OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
};

function renderFilter(filter: Filter, table: string, alias: string, ctx: Context): string {
  if (filter.kind === "group") {
    const inner = filter.filters.map((f) => renderFilter(f, table, alias, ctx)).join(` ${filter.join} `);
    return filter.negate ? `not (${inner})` : `(${inner})`;
  }

  const target = `${alias}.${column(ctx.catalog, table, filter.column)}`;
  let clause: string;
  const op = OPERATORS[filter.op];
  if (op) {
    // PostgREST spells the LIKE wildcard `*` so it survives a URL.
    const value = filter.op === "like" || filter.op === "ilike" ? filter.value.replace(/\*/g, "%") : filter.value;
    clause = `${target} ${op} ${ctx.params.add(value)}`;
  } else if (filter.op === "is") {
    const value = filter.value.toLowerCase();
    if (!["null", "true", "false", "unknown"].includes(value)) {
      throw new RestError(400, "PGRST100", `"is.${filter.value}" is not a filter`);
    }
    clause = `${target} is ${value}`;
  } else if (filter.op === "in") {
    if (!filter.value.startsWith("(") || !filter.value.endsWith(")")) {
      throw new RestError(400, "PGRST100", `"in.${filter.value}" is not a list`);
    }
    const values = splitTopLevel(filter.value.slice(1, -1)).map(unquote);
    clause = values.length === 0 ? "false" : `${target} = any(${ctx.params.add(values)})`;
  } else {
    throw unsupported(`the "${filter.op}" filter`);
  }
  return filter.negate ? `not (${clause})` : clause;
}

function whereClause(filters: Filter[], table: string, alias: string, ctx: Context): string {
  if (filters.length === 0) return "";
  return ` where ${filters.map((f) => renderFilter(f, table, alias, ctx)).join(" and ")}`;
}

function orderClause(order: Order[], table: string, alias: string, catalog: Catalog): string {
  if (order.length === 0) return "";
  const terms = order.map(
    (o) =>
      `${alias}.${column(catalog, table, o.column)} ${o.direction}${o.nulls ? ` nulls ${o.nulls}` : ""}`,
  );
  return ` order by ${terms.join(", ")}`;
}

function selectList(items: SelectItem[], table: string, alias: string, ctx: Context): string {
  return items
    .map((item) => {
      if (item.kind === "star") return `${alias}.*`;
      if (item.kind === "column") {
        const cast = item.cast ? `::${item.cast}` : "";
        return `${alias}.${column(ctx.catalog, table, item.name)}${cast} as ${ident(item.alias ?? item.name)}`;
      }
      return embed(item, table, alias, ctx);
    })
    .join(", ");
}

/**
 * An embedded resource is a correlated subquery along exactly one foreign key:
 * an object when this row holds the key (many-to-one), an array when the other
 * table does (one-to-many). Two keys between the same tables need a `!hint`,
 * exactly as PostgREST demands one.
 */
function embed(
  item: Extract<SelectItem, { kind: "embed" }>,
  parent: string,
  parentAlias: string,
  ctx: Context,
): string {
  const { fk, many } = relationship(ctx.catalog, parent, item.name, item.hint);
  const sub = `e${++ctx.aliases}`;
  const row = `__${sub}`;
  const on = fk.fromColumns
    .map((from, i) => {
      const to = fk.toColumns[i] ?? "";
      return many
        ? `${sub}.${ident(from)} = ${parentAlias}.${ident(to)}`
        : `${sub}.${ident(to)} = ${parentAlias}.${ident(from)}`;
    })
    .join(" and ");

  const inner = `select ${selectList(item.items, item.name, sub, ctx)} from public.${ident(item.name)} as ${sub} where ${on}`;
  const label = ident(item.alias ?? item.name);
  return many
    ? `coalesce((select json_agg(${row}) from (${inner}) as ${row}), '[]'::json) as ${label}`
    : `(select row_to_json(${row}) from (${inner} limit 1) as ${row}) as ${label}`;
}

function relationship(
  catalog: Catalog,
  parent: string,
  target: string,
  hint: string | undefined,
): { fk: ForeignKey; many: boolean } {
  const candidates = catalog.foreignKeys
    .flatMap((fk) => {
      const found: Array<{ fk: ForeignKey; many: boolean }> = [];
      if (fk.fromTable === parent && fk.toTable === target) found.push({ fk, many: false });
      if (fk.fromTable === target && fk.toTable === parent) found.push({ fk, many: true });
      return found;
    })
    .filter(({ fk }) => !hint || fk.name === hint || (fk.fromColumns.length === 1 && fk.fromColumns[0] === hint));

  const [only, ...others] = candidates;
  if (only && others.length === 0) return only;
  throw new RestError(
    400,
    only ? "PGRST201" : "PGRST200",
    only
      ? `More than one relationship was found for '${parent}' and '${target}'`
      : `Could not find a relationship between '${parent}' and '${target}'`,
    only ? `Name one: ${candidates.map((c) => c.fk.name).join(", ")}` : null,
  );
}

/**
 * Run `ctes` -- ending in one named `__row` -- and have Postgres hand back the
 * count, the JSON array, and its first element in one go.
 *
 * The name matters. A bare relation name in an expression means the whole
 * row only if no column has that name; otherwise Postgres takes the column.
 * This used to be `x`, and `tiles` has an `x` column, so every tile came back
 * as a bare number. Names that start with two underscores are never columns
 * here.
 */
async function aggregate(
  db: Queryable,
  ctes: string,
  params: Params,
): Promise<{ count: number; body: string; first: string | null }> {
  const { rows } = await db.query<{ count: number; body: string; first: string | null }>(
    `${ctes}
     select count(*)::int as count,
            coalesce(json_agg(__row), '[]'::json)::text as body,
            (json_agg(__row) -> 0)::text as first
     from __row`,
    params.values,
  );
  const row = rows[0];
  return row ?? { count: 0, body: "[]", first: null };
}

/* -------------------------------------------------------------------------
   Reads and writes
   ------------------------------------------------------------------------- */

async function read({ db, catalog, table, query, prefer, single }: Plan, head: boolean): Promise<Response> {
  const ctx: Context = { catalog, params: new Params(), aliases: 0 };
  const where = whereClause(query.filters, table, "t0", ctx);
  const from = `from public.${ident(table)} as t0${where}`;

  let total: number | null = null;
  if (prefer.count) {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n ${from}`, ctx.params.values);
    total = rows[0]?.n ?? 0;
  }
  if (head) return respond(200, null, contentRange(query.offset, 0, total));

  const list = selectList(query.select, table, "t0", ctx);
  const page =
    (query.limit !== undefined ? ` limit ${query.limit}` : "") + (query.offset ? ` offset ${query.offset}` : "");
  const result = await aggregate(
    db,
    `with __row as (select ${list} ${from}${orderClause(query.order, table, "t0", catalog)}${page})`,
    ctx.params,
  );

  if (single) {
    if (result.count !== 1) throw notOneRow(result.count);
    return respond(200, result.first, contentRange(query.offset, 1, total));
  }
  return respond(200, result.body, contentRange(query.offset, result.count, total));
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function insert(plan: Plan, payload: unknown): Promise<Response> {
  const { catalog, table, query, prefer } = plan;
  const rows = Array.isArray(payload) ? payload : [payload];
  if (!rows.every(isRow)) throw new RestError(400, "PGRST102", "Insert expects an object or an array of objects");

  const ctx: Context = { catalog, params: new Params(), aliases: 0 };
  const target = `public.${ident(table)}`;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const list = columns.map((c) => column(catalog, table, c)).join(", ");

  let statement: string;
  if (columns.length === 0) {
    if (rows.length !== 1) throw unsupported("inserting several empty rows");
    statement = `insert into ${target} default values`;
  } else {
    // json_populate_recordset does the typing: enums, jsonb, arrays and
    // timestamps arrive as JSON and are cast by the table's own column types.
    // A key one row lacks is null in that row, which is PostgREST's behaviour
    // too unless `missing=default` is asked for.
    const json = ctx.params.add(JSON.stringify(rows));
    statement = `insert into ${target} (${list}) select ${list} from json_populate_recordset(null::${target}, ${json}::json)`;
  }

  if (prefer.resolution) {
    const conflict = query.onConflict ?? catalog.primaryKeys.get(table) ?? [];
    if (conflict.length === 0) throw unsupported(`upserting into ${table}, which has no primary key`);
    const keys = conflict.map((c) => column(catalog, table, c)).join(", ");
    const updates = columns.filter((c) => !conflict.includes(c));
    statement +=
      prefer.resolution === "ignore" || updates.length === 0
        ? ` on conflict (${keys}) do nothing`
        : ` on conflict (${keys}) do update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`;
  }

  return write(plan, ctx, `${statement} returning *`, 201);
}

async function update(plan: Plan, payload: unknown): Promise<Response> {
  const { catalog, table, query } = plan;
  if (!isRow(payload) || Object.keys(payload).length === 0) {
    throw new RestError(400, "PGRST102", "Update expects an object with at least one column");
  }

  const ctx: Context = { catalog, params: new Params(), aliases: 0 };
  const target = `public.${ident(table)}`;
  const assignments = Object.keys(payload)
    .map((c) => `${column(catalog, table, c)} = r.${ident(c)}`)
    .join(", ");
  const json = ctx.params.add(JSON.stringify(payload));
  const where = whereClause(query.filters, table, "m", ctx);
  const statement =
    `update ${target} as m set ${assignments} ` +
    `from json_populate_record(null::${target}, ${json}::json) as r${where} returning m.*`;

  return write(plan, ctx, statement, 204);
}

async function remove(plan: Plan): Promise<Response> {
  const { catalog, table, query } = plan;
  const ctx: Context = { catalog, params: new Params(), aliases: 0 };
  const where = whereClause(query.filters, table, "m", ctx);
  return write(plan, ctx, `delete from public.${ident(table)} as m${where} returning m.*`, 204);
}

/**
 * Every write runs as `with t0 as (<statement> returning *)` so that the
 * select list, embeds included, is applied to the rows it touched. It runs in
 * a transaction so that `.single()` can refuse a write that touched the wrong
 * number of rows and take it back, as PostgREST does.
 */
async function write(plan: Plan, ctx: Context, statement: string, minimalStatus: number): Promise<Response> {
  const { db, table, query, prefer, single } = plan;
  const list = selectList(query.select, table, "t0", ctx);

  const result = await db.transaction(async (tx) => {
    const r = await aggregate(tx, `with t0 as (${statement}), __row as (select ${list} from t0)`, ctx.params);
    if (single && prefer.representation && r.count !== 1) throw notOneRow(r.count);
    return r;
  });

  const range = prefer.count ? `*/${result.count}` : null;
  if (!prefer.representation) return respond(minimalStatus === 201 ? 201 : 204, null, range);
  return respond(minimalStatus === 201 ? 201 : 200, single ? result.first : result.body, range);
}

async function rpc(db: Database, catalog: Catalog, name: string, request: Request): Promise<Response> {
  const fn = catalog.functions.get(name);
  if (!fn) throw new RestError(404, "PGRST202", `Could not find the function public.${name}`);
  if (request.method !== "POST") throw unsupported(`calling a function with ${request.method}`);

  const args = (await body(request)) ?? {};
  if (!isRow(args)) throw new RestError(400, "PGRST102", "Function arguments must be an object");

  const params = new Params();
  const named = Object.entries(args).map(([key, value]) => {
    const bound = value !== null && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value;
    return `${ident(key)} => ${params.add(bound)}`;
  });
  const call = `public.${ident(name)}(${named.join(", ")})`;

  const sql = fn.returnsSet
    ? `select coalesce(json_agg(__row), '[]'::json)::text as body from ${call} as __row`
    : fn.returnsRow
      ? `select row_to_json(__row)::text as body from ${call} as __row`
      : `select to_json(${call})::text as body`;

  const { rows } = await db.query<{ body: string | null }>(sql, params.values);
  return respond(200, rows[0]?.body ?? "null", null);
}

/* -------------------------------------------------------------------------
   Responses
   ------------------------------------------------------------------------- */

function notOneRow(count: number): RestError {
  return new RestError(
    406,
    "PGRST116",
    "JSON object requested, multiple (or no) rows returned",
    `The result contains ${count} rows`,
  );
}

function contentRange(offset: number, length: number, total: number | null): string {
  const span = length > 0 ? `${offset}-${offset + length - 1}` : "*";
  return `${span}/${total ?? "*"}`;
}

function respond(status: number, body: string | null, range: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (range) headers.set("Content-Range", range);
  return new Response(status === 204 ? null : body, { status, headers });
}

/** Postgres errors keep their SQLSTATE; the status follows PostgREST's mapping where it matters. */
function statusFor(code: string): number {
  if (code === "23503" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "42P01" || code === "42883") return 404;
  return 400;
}

function errorResponse(error: unknown): Response {
  if (error instanceof RestError) {
    return Response.json(
      { code: error.code, message: error.message, details: error.details, hint: null },
      { status: error.status },
    );
  }
  const e = error as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown } | null;
  if (e && typeof e.code === "string") {
    return Response.json(
      {
        code: e.code,
        message: String(e.message ?? ""),
        details: typeof e.detail === "string" ? e.detail : null,
        hint: typeof e.hint === "string" ? e.hint : null,
      },
      { status: statusFor(e.code) },
    );
  }
  console.error("[burg] local PostgREST failed", error);
  return Response.json(
    { code: "PGRST000", message: error instanceof Error ? error.message : String(error), details: null, hint: null },
    { status: 500 },
  );
}
