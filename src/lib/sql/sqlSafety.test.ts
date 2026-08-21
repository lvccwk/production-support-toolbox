import { describe, expect, it } from "vitest";
import { checkSqlSafety } from "./sqlSafety";

describe("SQL safety checker (section 9 & 21)", () => {
  it("flags UPDATE without WHERE as critical", () => {
    const result = checkSqlSafety("UPDATE customer SET status='X';");
    expect(result.safe).toBe(false);
    const critical = result.issues.find((i) => i.code === "UPDATE_WITHOUT_WHERE");
    expect(critical?.severity).toBe("critical");
    expect(critical?.message).toMatch(/does not contain a WHERE clause/i);
  });

  it("does NOT flag UPDATE with WHERE", () => {
    const result = checkSqlSafety(
      "UPDATE customer SET status='X' WHERE customer_id=1;",
    );
    expect(result.issues.filter((i) => i.code === "UPDATE_WITHOUT_WHERE")).toEqual([]);
    expect(result.safe).toBe(true);
  });

  it("flags DELETE without WHERE as critical", () => {
    const result = checkSqlSafety("DELETE FROM customer;");
    expect(result.issues.some((i) => i.code === "DELETE_WITHOUT_WHERE")).toBe(true);
  });

  it("does not flag DELETE with WHERE", () => {
    const result = checkSqlSafety("DELETE FROM customer WHERE id=1;");
    expect(result.safe).toBe(true);
  });

  it("flags DROP and TRUNCATE as critical", () => {
    const drop = checkSqlSafety("DROP TABLE customer;");
    expect(drop.issues.some((i) => i.code === "DROP_STATEMENT" && i.severity === "critical")).toBe(true);
    const truncate = checkSqlSafety("TRUNCATE TABLE customer;");
    expect(truncate.issues.some((i) => i.code === "TRUNCATE_STATEMENT")).toBe(true);
  });

  it("flags ALTER as warning", () => {
    const result = checkSqlSafety("ALTER TABLE customer ADD COLUMN x INT;");
    expect(result.issues.some((i) => i.code === "ALTER_STATEMENT" && i.severity === "warning")).toBe(true);
  });

  it("does not treat WHERE inside a string literal as a WHERE clause", () => {
    const result = checkSqlSafety("UPDATE customer SET note = 'where are you';");
    expect(result.issues.some((i) => i.code === "UPDATE_WITHOUT_WHERE")).toBe(true);
  });

  it("handles multiple statements independently", () => {
    const result = checkSqlSafety(
      "UPDATE customer SET status='X'; SELECT * FROM customer WHERE id=1;",
    );
    expect(result.issues.some((i) => i.code === "UPDATE_WITHOUT_WHERE")).toBe(true);
  });

  it("returns no issues for a plain safe SELECT", () => {
    expect(checkSqlSafety("SELECT * FROM customer WHERE id=1;").safe).toBe(true);
  });
});