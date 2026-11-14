import { DatabaseSync } from "node:sqlite";

const NAME = Symbol.for("nodejs.sqlite.statement");

/**
 * A small adapter that gives `node:sqlite` the parts of the
 * `better-sqlite3` surface this server uses:
 *
 *   db.prepare(sql).run(...), .all(), .get()
 *   db.exec(sql), db.pragma("journal_mode = WAL"), db.transaction(fn), db.close()
 *
 * It exists because `better-sqlite3` is a native module: when its prebuilt
 * binary is missing for the running Node version the whole server refuses to
 * boot. `node:sqlite` ships with Node, so the database layer never becomes the
 * reason the app is down.
 */
export default class Database {
  #conn: DatabaseSync;

  constructor(filename: string) {
    this.#conn = new DatabaseSync(filename);
  }

  prepare(sql: string) {
    const stmt: any = this.#conn.prepare(sql);
    const raw = (result: any) => {
      if (!result) return result;
      if (Array.isArray(result)) return result.map(unwrap);
      return unwrap(result);
    };
    return {
      run: (...params: any[]) => raw(stmt.run(...params)),
      all: (...params: any[]) => raw(stmt.all(...params)),
      get: (...params: any[]) => raw(stmt.get(...params)),
    };
  }

  exec(sql: string) {
    this.#conn.exec(sql);
    return this;
  }

  /** better-sqlite3's pragma() returns rows for reads and nothing for writes. */
  pragma(statement: string) {
    const sql = statement.trim();
    if (/^(select|pragma)\s/i.test(sql)) {
      return this.#conn.prepare(`PRAGMA ${sql}`).all();
    }
    this.#conn.exec(`PRAGMA ${sql}`);
    return undefined;
  }

  /** better-sqlite3 returns a function that wraps the body in a transaction. */
  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      this.#conn.exec("BEGIN");
      try {
        const result = fn(...args);
        this.#conn.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          this.#conn.exec("ROLLBACK");
        } catch {
          /* rollback on a dead connection is not worth masking the real error */
        }
        throw err;
      }
    }) as T;
  }

  close() {
    this.#conn.close();
  }
}

/** node:sqlite returns null-prototype rows; spread them into plain objects. */
function unwrap(row: any) {
  if (row && typeof row === "object" && !Array.isArray(row)) return { ...row };
  return row;
}

export { NAME };
