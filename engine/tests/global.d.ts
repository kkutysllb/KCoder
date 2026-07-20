/**
 * Ambient module declarations for dependencies that are only declared
 * in sub-packages but referenced from root-level tests.
 */

declare module 'better-sqlite3' {
  export interface Statement {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  export interface Database {
    prepare(sql: string): Statement
    exec(sql: string): void
    close(): void
    pragma(pragma: string): unknown
  }
  const betterSqlite3: {
    new (path: string): Database
  }
  export default betterSqlite3
}
