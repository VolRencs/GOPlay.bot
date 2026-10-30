import type { SQLInputValue, StatementResultingChanges, StatementSync } from "node:sqlite";
import { db } from "./database.ts";

export type ReadStatement<Row> = Omit<StatementSync, "get" | "all" | "iterate"> & {
  get(...params: SQLInputValue[]): Row | undefined;
  all(...params: SQLInputValue[]): Row[];
  iterate(...params: SQLInputValue[]): IterableIterator<Row>;
};

export function read<Row>(sql: string): ReadStatement<Row> {
  return db.prepare(sql) as unknown as ReadStatement<Row>;
}

export function write(sql: string): StatementSync {
  return db.prepare(sql);
}

type RowValue = SQLInputValue;

type UpsertStatement<Row extends Record<string, RowValue>> = {
  run(row: Row): StatementResultingChanges;
};

export function upsert<Row extends Record<string, RowValue>>(
  table: string,
  columns: readonly (keyof Row & string)[],
  key: readonly (keyof Row & string)[],
  update?: readonly string[],
): UpsertStatement<Row> {
  const keySet = new Set<string>(key);
  const assignments = update ?? columns.filter(column => !keySet.has(column)).map(column => `${column}=excluded.${column}`);
  const sql = `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")}) ON CONFLICT(${key.join(",")}) DO UPDATE SET ${assignments.join(",")}`;
  const statement = db.prepare(sql);
  return {
    run(row: Row) {
      return statement.run(...columns.map(column => row[column]!));
    },
  };
}
