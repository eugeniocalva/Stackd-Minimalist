/* A D1-shaped adapter over node:sqlite, so the SQL the Worker sends is the
   SQL the tests run (architecture §37). Only what the Worker uses:
   prepare().bind().first() / all() / run(), and batch() in one transaction. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const plain = (row) => (row ? { ...row } : null);
  class Stmt {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) {
      if (args.some((a) => a === undefined)) throw new Error('D1_TYPE_ERROR: undefined bound');
      return new Stmt(this.sql, args);
    }
    get prepared() { return db.prepare(this.sql); }
    async first(col) { const r = plain(this.prepared.get(...this.args)); return r && col ? r[col] : r; }
    async all() { return { success: true, results: this.prepared.all(...this.args).map(plain) }; }
    runNow() { const i = this.prepared.run(...this.args); return { success: true, meta: { changes: Number(i.changes) } }; }
    async run() { return this.runNow(); }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = stmts.map((s) => s.runNow()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    migrate(dir) {
      readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().forEach((f) => db.exec(readFileSync(new URL(f, dir), 'utf8')));
    },
  };
}
