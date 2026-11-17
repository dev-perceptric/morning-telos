// A small in-memory stand-in for the Supabase client: enough of the query builder for server code under test.
// Tables are arrays of rows. Not a database: the only constraint is the unique keys a test names.
// rpc() calls the functions a test puts in `rpcs`.
// Copied from Omniscient's tests/server/fakeDb.ts and trimmed.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export function fakeDb(uniques: Record<string, string[]> = {}) {
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
        rows.push({ ...payload });
        return { data: null, error: null };
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
      return one ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
    };

    const q = {
      select: () => q,
      insert: (p: Row) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      upsert: (p: Row, o: { onConflict: string }) => ((op = "upsert"), (payload = p), (conflict = o.onConflict.split(",").map((k) => k.trim())), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      maybeSingle: () => ((one = true), q),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad),
    };
    return q;
  }

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const fn = rpcs[name];
    if (!fn) return { data: null, error: { message: `Could not find the function public.${name}` } };
    return { data: fn(args), error: null };
  }

  return { tables, writes, failNext, rpcs, from, rpc };
}
