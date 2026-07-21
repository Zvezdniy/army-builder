import { Fragment } from "react";
import type { ReactNode } from "react";

const BOLD = new Set(["B", "STRONG"]);
const ITALIC = new Set(["I", "EM"]);
const DROP = new Set(["SCRIPT", "STYLE"]);

function childrenOf(node: Node, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  node.childNodes.forEach((child, i) => out.push(nodeToReact(child, `${keyBase}.${i}`)));
  return out;
}

function nodeToReact(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return null;
  if (tag === "BR") return <br key={key} />;
  const kids = childrenOf(el, key);
  if (BOLD.has(tag)) return <strong key={key}>{kids}</strong>;
  if (ITALIC.has(tag)) return <em key={key}>{kids}</em>;
  if (tag === "UL") return <ul key={key}>{kids}</ul>;
  if (tag === "LI") return <li key={key}>{kids}</li>;
  // span, div, and any other element: transparent — render children only, no attributes.
  return <Fragment key={key}>{kids}</Fragment>;
}

/** Render a constrained subset of Wahapedia effect-text HTML as safe React nodes.
 *  Parses with the browser's DOMParser and re-emits an allowlist of attribute-free
 *  elements (bold, italic, line break, list); span/div/unknown are transparent;
 *  script/style are dropped. Never uses dangerouslySetInnerHTML. */
export function renderStratagemHtml(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return childrenOf(doc.body, "n");
}
