import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderStratagemHtml } from "./stratagemHtml";

function view(html: string) {
  return render(<div data-testid="out">{renderStratagemHtml(html)}</div>);
}

describe("renderStratagemHtml", () => {
  it("renders <b> as bold text", () => {
    view("<b>WHEN:</b> your turn");
    expect(screen.getByText("WHEN:").tagName).toBe("STRONG");
    expect(screen.getByTestId("out").textContent).toBe("WHEN: your turn");
  });

  it("renders <br> as a line break element", () => {
    const { container } = view("a<br>b");
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders a keyword span transparently (text kept, no attributes)", () => {
    const { container } = view('one <span class="kwb">ADEPTUS</span> two');
    expect(screen.getByTestId("out").textContent).toBe("one ADEPTUS two");
    expect(container.querySelector("[class='kwb']")).toBeNull();
    expect(container.querySelector("span")).toBeNull(); // transparent → no span element
  });

  it("renders <ul>/<li> as a list", () => {
    const { container } = view("<ul><li>x</li><li>y</li></ul>");
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("drops <script> entirely (no text, no element)", () => {
    const { container } = view("safe<script>alert(1)</script>text");
    expect(screen.getByTestId("out").textContent).toBe("safetext");
    expect(container.querySelector("script")).toBeNull();
  });

  it("never emits event-handler or style attributes", () => {
    const { container } = view('<b onclick="evil()" style="color:red">x</b>');
    const strong = container.querySelector("strong")!;
    expect(strong.getAttribute("onclick")).toBeNull();
    expect(strong.getAttribute("style")).toBeNull();
  });
});
