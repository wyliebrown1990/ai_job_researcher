import { expect, test, describe } from "bun:test";
import { markdownToHtml } from "../src/lib/markdownToHtml.ts";

describe("markdownToHtml", () => {
  test("renders headings, bold, links, lists", () => {
    const html = markdownToHtml([
      "# Daily Digest",
      "## Top movers",
      "### HappyRobot — **82/100**",
      "- [Forward Deployed Engineer](https://jobs.ashbyhq.com/x) — _forward-deployed_",
      "---",
    ].join("\n"));
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).toContain("<strong>82/100</strong>");
    expect(html).toContain('<a href="https://jobs.ashbyhq.com/x"');
    expect(html).toContain("<li");
    expect(html).toContain("<em>forward-deployed</em>");
    expect(html).toContain("<hr");
  });

  test("escapes stray HTML in text but keeps generated tags", () => {
    const html = markdownToHtml("plain <script>alert(1)</script> text");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
