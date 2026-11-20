// A small in-memory stand-in for the Supabase client: enough of the query builder for server code under test.
// Tables are arrays of rows. Not a database: the only constraint is the unique keys a test names.
// rpc() calls the functions a test puts in `rpcs`.
// Copied from Omniscient's tests/server/fakeDb.ts and trimmed.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export function fakeDb(uniques: Record<string, string[]> = {}, o: { autoId?: string[] } = {}) {
  let nextId = 1000;
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  /** Every write, in order, so a test can check nothing changed. */
  const writes: { table: string; op: string; payload: unknown }[] = [];
  /** Make the next write to a table fail, to test error handling. */
  const failNext = new Map<string, string>();
  /** Stand-ins for SQL functions, by name. */
  const rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};

  function from(name: string) {
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" | "delete" | "upsert" = "select";
    let payload: Row | null = null;
    let conflict: string[] = [];
    let one = false;
    let sort: { col: string; asc: boolean } | null = null;
    let cap: number | null = null;
    /** .insert(...).select() returns the saved row, like PostgREST's return=representation. */
    let returning = false;

    const run = () => {
      const rows = table(name);
      if (op !== "select") {
        writes.push({ table: name, op, payload });
        const fail = failNext.get(name);
        if (fail) {
          failNext.delete(name);
          return { data: null, error: { message: fail } };
        }
      }
      if (op === "insert") {
        const keys = uniques[name] ?? [];
        if (keys.length && rows.some((x) => keys.every((k) => x[k] === payload![k]))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        const row = { ...(o.autoId?.includes(name) && payload!.id === undefined ? { id: ++nextId } : {}), ...payload };
        rows.push(row);
        return { data: returning ? (one ? row : [row]) : null, error: null };
      }
      if (op === "upsert") {
        const same = rows.find((x) => conflict.every((k) => x[k] === payload![k]));
        if (same) Object.assign(same, payload);
        else rows.push({ ...payload });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, payload));
        return { data: null, error: null };
      }
      if (op === "delete") {
        tables[name] = rows.filter((r) => !hit.includes(r));
        return { data: null, error: null };
      }
      if (sort) {
        const { col, asc } = sort;
        hit.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] as number) < (b[col] as number) === asc ? -1 : 1));
      }
      const capped = cap === null ? hit : hit.slice(0, cap);
      return one ? { data: capped[0] ?? null, error: null } : { data: capped, error: null };
    };

    const q = {
      select: () => ((returning = op !== "select"), q),
      insert: (p: Row) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      upsert: (p: Row, o: { onConflict: string }) => ((op = "upsert"), (payload = p), (conflict = o.onConflict.split(",").map((k) => k.trim())), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      // Compares as strings, which is right for ISO times and same-length ids.
      gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) >= String(v)), q),
      lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) < String(v)), q),
      // PostgREST's or=(a.is.null,a.eq.x): only "is.null" and "eq" are understood.
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => p.split("."));
        filters.push((r) => parts.some(([c, op, ...v]) => (op === "is" ? (r[c] ?? null) === null : op === "eq" ? String(r[c]) === v.join(".") : false)));
        return q;
      },
      maybeSingle: () => ((one = true), q),
      single: () => ((one = true), q),
      order: (col: string, o: { ascending?: boolean } = {}) => ((sort = { col, asc: o.ascending !== false }), q),
      limit: (n: number) => ((cap = n), q),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad),
    };
    return q;
  }

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const fn = rpcs[name];
    if (!fn) return { data: null, error: { message: `Could not find the function public.${name}` } };
    return { data: fn(args), error: null };
  }

  /** Supabase Storage: "<bucket>/<path>" → the file. failUpload makes the next upload fail. */
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const store = { failUpload: "" };
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array, o: { contentType?: string; upsert?: boolean } = {}) => {
        writes.push({ table: `storage:${bucket}`, op: "upload", payload: path });
        if (store.failUpload) {
          const message = store.failUpload;
          store.failUpload = "";
          return { data: null, error: { message } };
        }
        if (objects.has(`${bucket}/${path}`) && !o.upsert) return { data: null, error: { message: "The resource already exists" } };
        objects.set(`${bucket}/${path}`, { bytes: new Uint8Array(body), contentType: o.contentType ?? "application/octet-stream" });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const f = objects.get(`${bucket}/${path}`);
        if (!f) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([f.bytes], { type: f.contentType }), error: null };
      },
    }),
  };

  return { tables, writes, failNext, rpcs, from, rpc, storage, objects, store };
}
