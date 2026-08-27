import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum, fmtUSD, fmtDur } from "@/dashboard/lib/format";
import type { SessionTreeNode, SessionTreeResponse } from "@/data/domain/session";

/* ── flattening ─────────────────────────────────────────────────────────
   A table renders rows, so the nesting has to become a prefix string. Kept
   pure and exported: the branch drawing is the part worth testing, and it is
   easier to assert on a string than on nested markup.
   ─────────────────────────────────────────────────────────────────────── */

export interface FlatTreeRow {
  node: SessionTreeNode;
  /** Box-drawing prefix that places this row under its parent. */
  prefix: string;
}

export function flattenTree(root: SessionTreeNode | null | undefined): FlatTreeRow[] {
  if (!root) return [];

  const rows: FlatTreeRow[] = [];

  // `ancestorsContinue[i]` is true when the ancestor i levels up still has a
  // sibling after it, which is what decides between a vertical bar and a gap.
  const walk = (
    node: SessionTreeNode,
    depth: number,
    ancestorsContinue: boolean[],
    isLast: boolean
  ) => {
    rows.push({
      node,
      prefix:
        depth === 0
          ? ""
          : ancestorsContinue.map((cont) => (cont ? "│  " : "   ")).join("") +
            (isLast ? "└─ " : "├─ "),
    });

    // The row just pushed becomes an ancestor of everything below it, and it
    // draws a bar for them exactly when it is not the last of its siblings.
    const childAncestors = depth === 0 ? [] : [...ancestorsContinue, !isLast];
    node.children.forEach((child, i) => {
      walk(child, depth + 1, childAncestors, i === node.children.length - 1);
    });
  };

  walk(root, 0, [], true);
  return rows;
}

/**
 * What the root handed off: its whole subtree minus its own numbers. This is
 * the total the flat subagent table used to show, kept because "how much did
 * delegating cost me" is a different question from "what did this session cost".
 */
export function delegatedTotals(root: SessionTreeNode | null | undefined) {
  if (!root) return null;
  return {
    sessions: root.subtree.sessions - 1,
    tokens: root.subtree.tokens - ((root.input_tokens ?? 0) + (root.output_tokens ?? 0)),
    cost: root.subtree.cost - (root.total_cost ?? 0),
    tools: root.subtree.tools - (root.tools_total ?? 0),
    durationMs: root.subtree.durationMs - (root.duration_ms ?? 0),
  };
}

/** `reviewer · refactor`, or whichever half exists. */
export function nodeLabel(node: SessionTreeNode): string {
  const agent = node.agent ?? (node.session_type === "main" ? "main" : "session");
  return node.routingLabel ? `${agent} · ${node.routingLabel}` : agent;
}

/* ── component ──────────────────────────────────────────────────────────── */

export default function DelegationTree({
  tree,
  loading,
  currentId,
}: {
  tree: SessionTreeResponse | null;
  loading: boolean;
  currentId: string | undefined;
}) {
  const navigate = useNavigate();
  const rows = useMemo(() => flattenTree(tree?.root), [tree]);
  const delegated = useMemo(() => delegatedTotals(tree?.root), [tree]);

  const meta =
    rows.length > 1
      ? `(${rows.length} sessions${tree?.truncated ? ", truncated" : ""})`
      : undefined;

  return (
    <Section title="Delegation" meta={meta}>
      {loading ? (
        <LoadingPlaceholder />
      ) : rows.length <= 1 ? (
        <EmptyState message="No delegation" />
      ) : (
        <>
          {tree?.ancestorId && tree.ancestorId !== tree.root?.id && (
            <button
              type="button"
              className="mb-3 text-[10px] tracking-[0.08em] uppercase text-cyber-cyan/50 hover:text-cyber-cyan"
              onClick={() => navigate(`/sessions/${tree.ancestorId}`)}
            >
              {"↑"} Open the full tree from its root
            </button>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
                  <th className="text-left py-2 pr-4 font-normal">Agent</th>
                  <th className="text-left py-2 pr-4 font-normal">Model</th>
                  <th className="text-right py-2 pr-4 font-normal">Tokens</th>
                  <th className="text-right py-2 pr-4 font-normal">Tools</th>
                  <th className="text-right py-2 pr-4 font-normal">Duration</th>
                  <th className="text-right py-2 pr-4 font-normal">Cost</th>
                  {/* Cost of this session plus everything it delegated to —
                      the number that says what a branch really cost. */}
                  <th className="text-right py-2 font-normal">Branch</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ node, prefix }) => {
                  const isCurrent = node.id === currentId;
                  return (
                    <tr
                      key={node.id}
                      tabIndex={0}
                      role="button"
                      aria-current={isCurrent ? "true" : undefined}
                      className={`border-b border-cyber-cyan/5 transition-colors cursor-pointer ${
                        isCurrent ? "bg-cyber-cyan/10" : "hover:bg-cyber-cyan/5"
                      }`}
                      onClick={() => navigate(`/sessions/${node.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") navigate(`/sessions/${node.id}`);
                      }}
                    >
                      <td className="py-2 pr-4 text-cyber-cyan max-w-[280px] truncate">
                        <span className="text-cyber-cyan/30 whitespace-pre font-mono">
                          {prefix}
                        </span>
                        {nodeLabel(node)}
                        {node.status === "error" && (
                          <span className="ml-2 text-[10px] uppercase text-cyber-danger">
                            error
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-cyber-cyan/50 max-w-[160px] truncate">
                        {node.model_id ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                        {fmtNum((node.input_tokens ?? 0) + (node.output_tokens ?? 0))}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                        {fmtNum(node.tools_total ?? 0)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                        {fmtDur(node.duration_ms)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                        {fmtUSD(node.total_cost ?? 0)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-cyber-cyan">
                        {node.children.length > 0 ? fmtUSD(node.subtree.cost) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {delegated && delegated.sessions > 0 && (
                  <tr className="border-t-2 border-cyber-cyan/30 bg-cyber-cyan/[0.02] font-bold text-cyber-cyan">
                    <td className="py-2 pr-4 text-xs tracking-[0.08em] uppercase">
                      Delegated
                    </td>
                    <td className="py-2 pr-4 text-cyber-cyan/50">
                      {delegated.sessions} session{delegated.sessions === 1 ? "" : "s"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtNum(delegated.tokens)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtNum(delegated.tools)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtDur(delegated.durationMs)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtUSD(delegated.cost)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtUSD(tree?.root?.subtree.cost ?? 0)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {tree?.truncated && (
            <p className="mt-3 text-[10px] tracking-[0.08em] uppercase text-cyber-cyan/30">
              Tree cut at the depth limit — deeper sessions are not counted above.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
