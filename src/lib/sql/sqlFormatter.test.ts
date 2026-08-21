import { describe, expect, it } from "vitest";
import { formatSql, splitStatements } from "./sqlFormatter";
import { analyzeSql } from "./sqlAnalyzer";

describe("SQL formatter (section 9)", () => {
  it("formats a simple select into readable multi-line SQL", () => {
    const out = formatSql("select a,b,c from customer where status='A' order by created_date;");
    expect(out).toContain("SELECT");
    expect(out).toContain("FROM");
    expect(out).toContain("WHERE");
    expect(out).toContain("ORDER BY");
    expect(out).toMatch(/SELECT A, B, C\nFROM CUSTOMER/);
    expect(out).toMatch(/status = 'A'/i);
  });

  it("preserves string literals exactly", () => {
    const out = formatSql("select name from users where email='Tim''s@x.com';");
    expect(out).toContain("'Tim''s@x.com'");
  });

  it("handles JOIN statements", () => {
    const out = formatSql(
      "select c.name, o.total from customer c left join orders o on c.id=o.customer_id where o.total>100;",
    );
    expect(out).toMatch(/LEFT JOIN/);
    expect(out).toMatch(/ON/);
    expect(out).toMatch(/SELECT C\.NAME, O\.TOTAL/);
  });

  it("throws friendly error on empty input", () => {
    expect(() => formatSql("   ")).toThrowError(/Empty input/i);
  });

  it("splits statements respecting string literals", () => {
    const statements = splitStatements(
      "UPDATE t SET note='a;b'; SELECT 1; -- trailing comment",
    );
    expect(statements).toEqual(["UPDATE t SET note = 'a;b'", "SELECT 1"]);
  });
});

describe("SQL basic analysis (section 9)", () => {
  it("identifies SELECT, tables, WHERE, JOIN, ORDER BY, GROUP BY", () => {
    const analysis = analyzeSql(
      `SELECT c.name, COUNT(o.id) AS total
       FROM customer c
       JOIN orders o ON o.customer_id = c.id
       WHERE c.status = 'A'
       GROUP BY c.name
       ORDER BY total DESC
       LIMIT 10;`,
    );
    expect(analysis.statementType).toBe("SELECT");
    expect(analysis.tables).toEqual(expect.arrayContaining(["customer", "orders"]));
    expect(analysis.hasWhere).toBe(true);
    expect(analysis.joins).toContain("JOIN");
    expect(analysis.groupBy).toContain("c.name");
    expect(analysis.orderBy).toContain("total");
    expect(analysis.hasLimit).toBe(true);
  });

  it("identifies UPDATE with parameters", () => {
    const analysis = analyzeSql("UPDATE customer SET status = ? WHERE id = ?;");
    expect(analysis.statementType).toBe("UPDATE");
    expect(analysis.tables).toContain("customer");
    expect(analysis.hasWhere).toBe(true);
    expect(analysis.parameterCount).toBe(2);
  });

  it("identifies DELETE / INSERT / DROP", () => {
    expect(analyzeSql("DELETE FROM audit_log WHERE id=1;").statementType).toBe("DELETE");
    expect(analyzeSql("INSERT INTO audit_log (x) VALUES (1);").statementType).toBe("INSERT");
    expect(analyzeSql("DROP TABLE audit_log;").statementType).toBe("DROP");
  });

  it("ignores keywords inside string literals", () => {
    const analysis = analyzeSql("SELECT 'where' FROM dual;");
    expect(analysis.hasWhere).toBe(false);
  });
});