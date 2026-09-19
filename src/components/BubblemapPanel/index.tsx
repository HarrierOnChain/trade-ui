"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFundingChain,
  fetchFundingCluster,
  fetchHolderEdges,
  type FundingChainEntry,
  type FundingCluster,
  type HolderEdge,
} from "../../api/client";
import { WalletLabel } from "../../hooks/useWalletLabels";
import { shortAddr } from "../../lib/format";
import type { Holder } from "../../types";
import { Icon } from "../atoms";
import styles from "./styles.module.css";

interface Props {
  addresses: string[];
  holders?: Holder[];
  mint?: string | null;
  onWalletClick?: (addr: string) => void;
}

type BubbleData = {
  clusters: FundingCluster[];
  unclustered: string[];
  chains: Record<string, FundingChainEntry[]>;
  edges: HolderEdge[];
};

type Entry = {
  address: string;
  rank: number;
  percentage: number;
  isLP: boolean;
  clusterIndex: number | null;
  rootFunder: string | null;
  funder: string | null;
  edgeCount: number;
};

type Node = {
  address: string;
  baseX: number;
  baseY: number;
  r: number;
  clusterIndex: number | null;
  isLP: boolean;
  rank: number;
  percentage: number;
};

type Edge = {
  id: string;
  from: string;
  to: string;
  kind: "funding" | "transfer";
  clusterIndex: number | null;
};

type Cluster = {
  index: number;
  rootFunder: string;
  wallets: string[];
};

type FilterKey = "all" | "cluster" | "lp" | "funded";

const W = 1400;
const H = 900;

const PALETTE = [
  "oklch(0.82 0.15 150)", // green
  "oklch(0.68 0.19 25)",  // ember
  "oklch(0.72 0.14 280)", // violet
  "oklch(0.75 0.12 230)", // azure
  "oklch(0.82 0.17 72)",  // gold
];
const LP_COLOR = "oklch(0.80 0.14 170)";
const NEUTRAL = "oklch(0.78 0.06 240)";

export function BubblemapPanel({ addresses, holders, mint, onWalletClick }: Props) {
  // ── data fetch ───────────────────────────────────────────────
  const [data, setData] = useState<BubbleData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputAddrs = useMemo(
    () => (addresses.length > 0 ? addresses : (holders ?? []).map((h) => h.address)),
    [addresses, holders],
  );
  const stableAddrs = useMemo(() => {
    // Cap at top 100 holders by rank. Preserve input order (holders are
    // pre-sorted by rank) so the cap takes the top-N rather than an
    // alphabetical slice. Then sort the final list to keep `requestKey`
    // stable across re-renders that reorder the input.
    const seen = new Set<string>();
    const ranked: string[] = [];
    for (const a of inputAddrs) {
      if (a && !seen.has(a)) {
        seen.add(a);
        ranked.push(a);
        if (ranked.length >= 100) break;
      }
    }
    return ranked.sort();
  }, [inputAddrs]);

  const requestKey = useMemo(() => `${mint ?? ""}|${stableAddrs.join(",")}`, [mint, stableAddrs]);
  const lastKey = useRef<string | null>(null);
  const lastSet = useRef<Set<string>>(new Set());
  const lastMint = useRef<string | null>(null);

  useEffect(() => {
    if (stableAddrs.length === 0) {
      setData({ clusters: [], unclustered: [], chains: {}, edges: [] });
      setRefreshing(false);
      setError(null);
      lastKey.current = requestKey;
      lastSet.current = new Set();
      lastMint.current = mint ?? null;
      return;
    }
    const sameMint = (lastMint.current ?? null) === (mint ?? null);
    if (sameMint && lastSet.current.size > 0) {
      let changed = 0;
      const ns = new Set(stableAddrs);
      for (const a of stableAddrs) if (!lastSet.current.has(a)) changed++;
      for (const a of lastSet.current) if (!ns.has(a)) changed++;
      if (changed < 5) return;
    }
    let cancelled = false;
    setError(null);
    setRefreshing(true);
    const t = setTimeout(() => {
      (async () => {
        try {
          const [cRes, chRes, eRes] = await Promise.all([
            fetchFundingCluster(stableAddrs, 3),
            fetchFundingChain(stableAddrs, 5),
            mint
              ? fetchHolderEdges(mint, stableAddrs)
              : Promise.resolve({ success: true, mint: "", edges: [] as HolderEdge[] }),
          ]);
          if (cancelled) return;
          setData({
            clusters: cRes.clusters ?? [],
            unclustered: cRes.unclustered ?? [],
            chains: chRes.chains ?? {},
            edges: eRes.edges ?? [],
          });
          lastKey.current = requestKey;
          lastSet.current = new Set(stableAddrs);
          lastMint.current = mint ?? null;
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!cancelled) setRefreshing(false);
        }
      })();
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // ── derived layout ───────────────────────────────────────────
  const { entries, nodes, edges, clusters } = useMemo(
    () => buildLayout(data, holders ?? [], stableAddrs),
    [data, holders, stableAddrs],
  );

  // ── view state ───────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hoverAddr, setHoverAddr] = useState<string | null>(null);
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  const [draggingAddr, setDraggingAddr] = useState<string | null>(null);
  // Live position of the actively-dragged node. Kept separate from the
  // committed `positions` map so a drag only triggers one tiny state update
  // per frame instead of cloning a 100+ entry Map. Committed on mouseup.
  const [dragOverride, setDragOverride] = useState<{ address: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showLabels, setShowLabels] = useState(true);
  const [showLinks, setShowLinks] = useState(true);

  const posOf = (addr: string): { x: number; y: number } | undefined => {
    if (dragOverride && dragOverride.address === addr) return dragOverride;
    return positions.get(addr);
  };

  // sync positions when layout rebuilds (preserve user-moved positions when address still present)
  useEffect(() => {
    setPositions((prev) => {
      const next = new Map<string, { x: number; y: number }>();
      for (const node of nodes) {
        const ex = prev.get(node.address);
        next.set(node.address, ex ?? { x: node.baseX, y: node.baseY });
      }
      return next;
    });
  }, [nodes]);

  // initial fit when nodes first arrive
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current) return;
    if (nodes.length === 0) return;
    fitToBounds(nodes, positions, setVb);
    didInitialFit.current = true;
  }, [nodes, positions]);

  // ── interaction refs ─────────────────────────────────────────
  const dragRef = useRef<{
    address: string;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    lastX: number;
    lastY: number;
  } | null>(null);

  const panRef = useRef<{
    sx: number;
    sy: number;
    vb: { x: number; y: number; w: number; h: number };
    moved: boolean;
  } | null>(null);

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  };

  // wheel zoom (cursor-anchored, viewBox-based)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = svgPoint(e.clientX, e.clientY);
      if (!p) return;
      setVb((cur) => {
        const factor = e.deltaY < 0 ? 1 / 1.15 : 1.15;
        const minW = W * 0.2;
        const maxW = W * 4;
        const minH = H * 0.2;
        const maxH = H * 4;
        const newW = Math.max(minW, Math.min(maxW, cur.w * factor));
        const newH = Math.max(minH, Math.min(maxH, cur.h * factor));
        const fx = newW / cur.w;
        const fy = newH / cur.h;
        return {
          w: newW,
          h: newH,
          x: p.x - (p.x - cur.x) * fx,
          y: p.y - (p.y - cur.y) * fy,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // global pointer listeners — drag node OR pan.
  // Mousemove can fire faster than the display refresh; coalesce events into
  // a single rAF tick so we do at most one React state update per frame.
  // Drags target a small `dragOverride` state instead of cloning the full
  // `positions` Map, so a 100+ node graph doesn't reconcile per move.
  useEffect(() => {
    let rafId: number | null = null;
    let pendingX = 0;
    let pendingY = 0;
    let hasPending = false;

    const flush = () => {
      rafId = null;
      if (!hasPending) return;
      hasPending = false;
      const drag = dragRef.current;
      const pan = panRef.current;
      if (drag) {
        const p = svgPoint(pendingX, pendingY);
        if (!p) return;
        drag.moved = true;
        const x = p.x - drag.offsetX;
        const y = p.y - drag.offsetY;
        drag.lastX = x;
        drag.lastY = y;
        setDragOverride({ address: drag.address, x, y });
      } else if (pan) {
        const dxScreen = pendingX - pan.sx;
        const dyScreen = pendingY - pan.sy;
        if (Math.abs(dxScreen) + Math.abs(dyScreen) > 2) pan.moved = true;
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const sx = pan.vb.w / Math.max(rect.width, 1);
        const sy = pan.vb.h / Math.max(rect.height, 1);
        setVb({
          x: pan.vb.x - dxScreen * sx,
          y: pan.vb.y - dyScreen * sy,
          w: pan.vb.w,
          h: pan.vb.h,
        });
      }
    };

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current && !panRef.current) return;
      pendingX = e.clientX;
      pendingY = e.clientY;
      hasPending = true;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const onUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      hasPending = false;
      const drag = dragRef.current;
      if (drag) {
        if (!drag.moved) {
          // treat as click → toggle selection
          setSelectedAddr((s) => (s === drag.address ? null : drag.address));
        } else {
          // commit the live drag position to `positions` once on release
          const finalX = drag.lastX;
          const finalY = drag.lastY;
          const addr = drag.address;
          setPositions((prev) => {
            const next = new Map(prev);
            next.set(addr, { x: finalX, y: finalY });
            return next;
          });
        }
      }
      dragRef.current = null;
      panRef.current = null;
      setDragOverride(null);
      setDraggingAddr(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onNodeMouseDown = (node: Node, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = svgPoint(e.clientX, e.clientY);
    if (!p) return;
    const pos = positions.get(node.address) ?? { x: node.baseX, y: node.baseY };
    dragRef.current = {
      address: node.address,
      offsetX: p.x - pos.x,
      offsetY: p.y - pos.y,
      moved: false,
      lastX: pos.x,
      lastY: pos.y,
    };
    setDraggingAddr(node.address);
  };

  const onStageMouseDown = (e: React.MouseEvent) => {
    // Block middle-click autoscroll & right-click oddities on the stage.
    if (e.button !== 0) {
      e.preventDefault();
      return;
    }
    if ((e.target as HTMLElement).closest("[data-bm-node]")) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, vb, moved: false };
  };

  const onStageDoubleClick = () => fitToBounds(nodes, positions, setVb);

  const zoomBy = (factor: number) => {
    setVb((cur) => {
      const cx = cur.x + cur.w / 2;
      const cy = cur.y + cur.h / 2;
      const minW = W * 0.2;
      const maxW = W * 4;
      const minH = H * 0.2;
      const maxH = H * 4;
      const newW = Math.max(minW, Math.min(maxW, cur.w / factor));
      const newH = Math.max(minH, Math.min(maxH, cur.h / factor));
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
  };

  // ── adjacency / trail ────────────────────────────────────────
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [edges]);

  // Floating overlay card uses hover-or-selection so you can browse on hover.
  const focusAddr = hoverAddr || selectedAddr;
  // Trail-dimming is driven by SELECTION only — hovering must not wash out
  // every other wallet in the graph.
  const trail = useMemo(() => {
    if (!selectedAddr) return null;
    const set = new Set<string>([selectedAddr]);
    adjacency.get(selectedAddr)?.forEach((a) => set.add(a));
    const meta = entries.find((e) => e.address === selectedAddr);
    if (meta?.funder) set.add(meta.funder);
    if (meta?.rootFunder) set.add(meta.rootFunder);
    for (const e of entries) {
      if (e.funder === selectedAddr || e.rootFunder === selectedAddr) set.add(e.address);
    }
    return set;
  }, [selectedAddr, adjacency, entries]);

  // ── filter / search ──────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === "cluster" && e.clusterIndex === null) return false;
      if (filter === "lp" && !e.isLP) return false;
      if (filter === "funded" && !e.funder) return false;
      if (q) {
        if (
          !e.address.toLowerCase().includes(q) &&
          !shortAddr(e.address, 4).toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [entries, filter, query]);

  const filteredAddrs = useMemo(
    () => new Set(filteredEntries.map((e) => e.address)),
    [filteredEntries],
  );

  // ── cluster halo geometry from current positions ─────────────
  const halos = useMemo(() => {
    return clusters.map((c) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let count = 0;
      for (const addr of c.wallets) {
        const p = positions.get(addr);
        if (!p) continue;
        count++;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (count === 0) return null;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const r = Math.max(maxX - minX, maxY - minY) / 2 + 60;
      return { cluster: c, cx, cy, r };
    }).filter((h): h is NonNullable<typeof h> => h !== null);
  }, [clusters, positions]);

  // ── hover (debounced clear to prevent flicker between adjacent nodes) ──
  const hoverClearTimer = useRef<number | null>(null);

  const onNodeEnter = (_e: React.MouseEvent, node: Node) => {
    if (hoverClearTimer.current !== null) {
      clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    if (hoverAddr !== node.address) {
      setHoverAddr(node.address);
    }
  };

  const onNodeLeave = () => {
    if (hoverClearTimer.current !== null) clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = window.setTimeout(() => {
      setHoverAddr(null);
      hoverClearTimer.current = null;
    }, 90);
  };

  useEffect(() => {
    return () => {
      if (hoverClearTimer.current !== null) clearTimeout(hoverClearTimer.current);
    };
  }, []);

  // ── keyboard ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "Escape") setSelectedAddr(null);
      else if (e.key === "+" || e.key === "=") zoomBy(1.18);
      else if (e.key === "-") zoomBy(1 / 1.18);
      else if (e.key === "f" || e.key === "F") fitToBounds(nodes, positions, setVb);
      else if (e.key === "l" || e.key === "L") setShowLabels((s) => !s);
      else if (e.key === "t" || e.key === "T") setShowLinks((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, positions]);

  // ── early states ─────────────────────────────────────────────
  if (stableAddrs.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>No wallets in scope for the bubblemap.</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>Bubblemap error: {error}</span>
      </div>
    );
  }

  const activeEntry = focusAddr ? entries.find((e) => e.address === focusAddr) ?? null : null;
  const stats = {
    wallets: entries.length,
    clusters: clusters.length,
    transfers: edges.filter((e) => e.kind === "transfer").length,
    funding: edges.filter((e) => e.kind === "funding").length,
    clustered: entries.filter((e) => e.clusterIndex !== null).length,
    pctClustered: entries.filter((e) => e.clusterIndex !== null).reduce((s, e) => s + e.percentage, 0).toFixed(2),
  };

  // ── render ───────────────────────────────────────────────────
  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        {/* main stage */}
        <div
          ref={stageRef}
          className={styles.stage}
          onMouseDown={onStageMouseDown}
          onDoubleClick={onStageDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          <svg
            ref={svgRef}
            className={styles.svg}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            preserveAspectRatio="xMidYMid meet"
            onDragStart={(e) => e.preventDefault()}
          >
            <defs>
              <filter id="bm-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {PALETTE.map((color, i) => (
                <radialGradient key={i} id={`bm-c${i}`} cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stopColor="oklch(1 0 0 / 0.5)" />
                  <stop offset="60%" stopColor={color} stopOpacity="0.85" />
                  <stop offset="100%" stopColor="oklch(0.14 0.006 65)" stopOpacity="0.95" />
                </radialGradient>
              ))}
              <radialGradient id="bm-default" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="oklch(1 0 0 / 0.4)" />
                <stop offset="65%" stopColor={NEUTRAL} stopOpacity="0.78" />
                <stop offset="100%" stopColor="oklch(0.14 0.006 65)" stopOpacity="0.96" />
              </radialGradient>
              <radialGradient id="bm-lp" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="oklch(1 0 0 / 0.5)" />
                <stop offset="60%" stopColor={LP_COLOR} stopOpacity="0.85" />
                <stop offset="100%" stopColor="oklch(0.14 0.006 65)" stopOpacity="0.96" />
              </radialGradient>
            </defs>

            {/* halos */}
            {halos.map((h) => {
              const color = PALETTE[h.cluster.index % PALETTE.length];
              const isActive =
                activeEntry?.clusterIndex === h.cluster.index ||
                hoverAddr && entries.find((e) => e.address === hoverAddr)?.clusterIndex === h.cluster.index;
              return (
                <g key={`halo-${h.cluster.index}`} className={styles.haloGroup}>
                  <circle
                    className={styles.halo}
                    cx={h.cx}
                    cy={h.cy}
                    r={h.r}
                    fill={color}
                    fillOpacity={isActive ? 0.07 : 0.025}
                    stroke={color}
                    strokeOpacity={isActive ? 0.5 : 0.22}
                  />
                  {showLabels && (
                    <text
                      className={styles.haloLabel}
                      x={h.cx}
                      y={h.cy - h.r - 12}
                      textAnchor="middle"
                      fill={color}
                    >
                      CLUSTER {String.fromCharCode(65 + h.cluster.index)} · {h.cluster.wallets.length}
                    </text>
                  )}
                </g>
              );
            })}

            {/* edges */}
            {showLinks && edges.map((edge) => {
              const a = posOf(edge.from);
              const b = posOf(edge.to);
              if (!a || !b) return null;
              const inTrail = trail && trail.has(edge.from) && trail.has(edge.to);
              const dim = trail && !inTrail;
              const color = inTrail
                ? "var(--accent)"
                : edge.clusterIndex !== null
                ? PALETTE[edge.clusterIndex % PALETTE.length]
                : "var(--paper-4)";
              return (
                <line
                  key={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={[
                    styles.edge,
                    edge.kind === "transfer" ? styles.edgeTransfer : styles.edgeFunding,
                    inTrail ? styles.edgeActive : "",
                    dim ? styles.edgeDim : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  stroke={color}
                  strokeWidth={inTrail ? 2 : edge.kind === "funding" ? 1.1 : 0.8}
                  strokeDasharray={edge.kind === "transfer" ? "4 4" : "0"}
                />
              );
            })}

            {/* nodes */}
            {nodes.map((node) => {
              const p = posOf(node.address) ?? { x: node.baseX, y: node.baseY };
              const isHover = hoverAddr === node.address;
              const isSelected = selectedAddr === node.address;
              const isDragging = draggingAddr === node.address;
              const inTrail = !trail || trail.has(node.address);
              const passesFilter = filter === "all" && !query.trim() ? true : filteredAddrs.has(node.address);
              const dim = !inTrail || !passesFilter;
              const color =
                node.isLP
                  ? LP_COLOR
                  : node.clusterIndex !== null
                  ? PALETTE[node.clusterIndex % PALETTE.length]
                  : NEUTRAL;
              const grad = node.isLP
                ? "url(#bm-lp)"
                : node.clusterIndex !== null
                ? `url(#bm-c${node.clusterIndex % PALETTE.length})`
                : "url(#bm-default)";
              return (
                <g
                  key={node.address}
                  data-bm-node
                  transform={`translate(${p.x} ${p.y})`}
                  className={[
                    styles.node,
                    isDragging ? styles.nodeDragging : "",
                    isSelected ? styles.nodeSelected : "",
                    dim ? styles.nodeDim : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseDown={(e) => onNodeMouseDown(node, e)}
                  onMouseEnter={(e) => onNodeEnter(e, node)}
                  onMouseLeave={onNodeLeave}
                >
                  {(isHover || isSelected) && (
                    <circle
                      r={node.r + 8}
                      fill="none"
                      stroke={isSelected ? "var(--accent)" : "var(--paper-2)"}
                      strokeWidth={1.2}
                      opacity={isSelected ? 0.9 : 0.45}
                      className={isSelected ? styles.selectionPulse : ""}
                    />
                  )}
                  <circle
                    r={node.r}
                    fill={grad}
                    stroke={color}
                    strokeOpacity={isSelected ? 1 : 0.78}
                    strokeWidth={isSelected ? 1.8 : 1}
                    filter={isSelected ? "url(#bm-glow)" : ""}
                  />
                  {node.rank <= 5 && node.r > 11 && (
                    <text textAnchor="middle" dominantBaseline="central" className={styles.rankLabel}>
                      {node.rank}
                    </text>
                  )}
                  {node.isLP && (
                    <text textAnchor="middle" dominantBaseline="central" className={styles.kindLabel}>
                      LP
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* floating selection card (hover or selected) */}
          {activeEntry && (
            <div className={styles.stageCard} key={activeEntry.address}>
              <div className={styles.stageCardTop}>
                <span className={styles.selectionEyebrow}>
                  {selectedAddr === activeEntry.address ? "Selected" : "Inspecting"}
                </span>
                {selectedAddr === activeEntry.address && (
                  <button
                    className={styles.selectionClose}
                    onClick={() => setSelectedAddr(null)}
                    title="esc"
                  >
                    {Icon.close(11)}
                  </button>
                )}
              </div>
              <div className={styles.selectionTitle}>
                #{activeEntry.rank}{" "}
                <span className={styles.selectionPct}>{formatPct(activeEntry.percentage)}</span>
              </div>
              <div className={styles.selectionAddr}>
                <WalletLabel address={activeEntry.address} chars={6} />
              </div>
              <div className={styles.selectionFullAddr}>{activeEntry.address}</div>
              <div className={styles.chipRow}>
                <span
                  className={styles.chip}
                  style={{
                    borderColor: activeEntry.isLP
                      ? LP_COLOR
                      : activeEntry.clusterIndex !== null
                      ? PALETTE[activeEntry.clusterIndex % PALETTE.length]
                      : "var(--line-soft)",
                    color: activeEntry.isLP
                      ? LP_COLOR
                      : activeEntry.clusterIndex !== null
                      ? PALETTE[activeEntry.clusterIndex % PALETTE.length]
                      : "var(--paper-2)",
                  }}
                >
                  {labelKind(activeEntry)}
                </span>
                {activeEntry.funder && (
                  <span className={styles.chip}>Funded by {shortAddr(activeEntry.funder, 3)}</span>
                )}
                <span className={styles.chip}>
                  {activeEntry.edgeCount} {activeEntry.edgeCount === 1 ? "link" : "links"}
                </span>
              </div>
              <div className={styles.selectionActions}>
                {onWalletClick && (
                  <button
                    className={styles.primaryAction}
                    onClick={() => onWalletClick(activeEntry.address)}
                  >
                    {Icon.filter(11)}
                    <span>Filter trades</span>
                  </button>
                )}
                <button
                  className={styles.secondaryAction}
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      navigator.clipboard.writeText(activeEntry.address).catch(() => {});
                    }
                  }}
                >
                  {Icon.copy(11)}
                  <span>Copy</span>
                </button>
              </div>
            </div>
          )}

          {/* loading overlay */}
          {(refreshing && !data) && (
            <div className={styles.loadingWrap}>
              <div className={styles.loadingOrb} />
              <span className={styles.loadingText}>Resolving funding graph</span>
            </div>
          )}

          {/* zoom controls */}
          <div className={styles.controls}>
            <button className={styles.iconBtn} onClick={() => zoomBy(1.18)} title="Zoom in (+)">+</button>
            <button className={styles.iconBtn} onClick={() => zoomBy(1 / 1.18)} title="Zoom out (−)">−</button>
            <button
              className={styles.iconBtn}
              onClick={() => fitToBounds(nodes, positions, setVb)}
              title="Fit (F)"
            >
              ⊡
            </button>
            <button
              className={`${styles.iconBtn} ${showLabels ? styles.iconBtnOn : ""}`}
              onClick={() => setShowLabels((s) => !s)}
              title="Toggle labels (L)"
            >
              A
            </button>
            <button
              className={`${styles.iconBtn} ${showLinks ? styles.iconBtnOn : ""}`}
              onClick={() => setShowLinks((s) => !s)}
              title="Toggle transfers (T)"
            >
              ⇄
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => {
                setPositions(() => {
                  const m = new Map<string, { x: number; y: number }>();
                  for (const n of nodes) m.set(n.address, { x: n.baseX, y: n.baseY });
                  return m;
                });
                fitToBounds(nodes, undefined, setVb);
              }}
              title="Reset layout"
            >
              ↺
            </button>
          </div>

          {/* legend */}
          <div className={styles.legend}>
            <div className={styles.legendHead}>Legend</div>
            {clusters.slice(0, 3).map((c) => (
              <div key={c.index} className={styles.legendRow}>
                <span
                  className={styles.legendDot}
                  style={{ background: PALETTE[c.index % PALETTE.length] }}
                />
                <span>
                  Cluster {String.fromCharCode(65 + c.index)} · {c.wallets.length} wallets
                </span>
              </div>
            ))}
            <div className={styles.legendRow}>
              <span className={styles.legendDot} style={{ background: LP_COLOR }} />
              <span>Liquidity pool</span>
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendDot} style={{ background: NEUTRAL }} />
              <span>Independent</span>
            </div>
          </div>

          {/* zoom hint */}
          <div className={styles.zoomHint}>
            <span>{Math.round((W / vb.w) * 100)}%</span>
            <span className={styles.zoomHintSep} />
            <span>DRAG · WHEEL · DBLCLICK FIT</span>
          </div>
        </div>

      </div>

      <div className={styles.footer}>
        <span>
          {stats.wallets} wallets · {stats.pctClustered}% clustered
        </span>
        <span className={styles.spacer} />
        <span>+ ZOOM</span>
        <span>− ZOOM</span>
        <span>F FIT</span>
        <span>L LABELS</span>
        <span>T TRANSFERS</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Layout (deterministic, runs once per data change)
// ─────────────────────────────────────────────────────────────────

function buildLayout(
  data: BubbleData | null,
  holders: Holder[],
  stableAddrs: string[],
): { entries: Entry[]; nodes: Node[]; edges: Edge[]; clusters: Cluster[] } {
  if (!data) return { entries: [], nodes: [], edges: [], clusters: [] };

  const byAddr = new Map(holders.map((h) => [h.address, h]));

  // ── normalize entries (rank, percentage, isLP) ──
  const baseEntries: Entry[] = stableAddrs.map((address, i) => {
    const h = byAddr.get(address);
    return {
      address,
      rank: h?.rank ?? i + 1,
      percentage: h?.percentage ?? 0,
      isLP: h?.isLiquidityPool ?? false,
      clusterIndex: null,
      rootFunder: null,
      funder: null,
      edgeCount: 0,
    };
  });

  // sort by rank
  baseEntries.sort((a, b) => a.rank - b.rank);

  // ── build clusters: funding groups ∪ direct-transfer components ──
  // Clusters used to come ONLY from the funding-cluster API, so a wallet
  // linked to others purely by direct token/SOL transfers (the "N links"
  // edges) was mislabeled "Independent". Merge both signals with union-find:
  // wallets that share a funder OR transferred directly to each other land in
  // the same cluster, and every connected component of ≥2 wallets surfaces as
  // a cluster. LP wallets are excluded as union hubs since transfers to/from a
  // pool are swaps, not peer relationships (one pool would merge all traders).
  const lpSet = new Set(baseEntries.filter((e) => e.isLP).map((e) => e.address));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    while (x !== root) {
      const next = parent.get(x) ?? root;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const touch = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    touch(a);
    touch(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // funding groups: union every member, remember the shared funder for labeling
  const fundingRoot = new Map<string, string>();
  for (const c of data.clusters) {
    for (const w of c.wallets) {
      touch(w);
      if (!fundingRoot.has(w)) fundingRoot.set(w, c.rootFunder);
    }
    for (let i = 1; i < c.wallets.length; i++) union(c.wallets[0], c.wallets[i]);
  }
  // direct holder transfers: each link joins its two endpoints
  for (const e of data.edges) {
    if (lpSet.has(e.a) || lpSet.has(e.b)) continue;
    union(e.a, e.b);
  }

  const comps = new Map<string, string[]>();
  for (const addr of parent.keys()) {
    const root = find(addr);
    const list = comps.get(root);
    if (list) list.push(addr);
    else comps.set(root, [addr]);
  }

  // components of ≥2 wallets become clusters; a component keeps a funding label
  // if any member had one, else it's a transfer-only ("linked") cluster.
  const sortedClusters: Cluster[] = [...comps.values()]
    .filter((wallets) => wallets.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((wallets, index) => {
      let rootFunder = "";
      for (const w of wallets) {
        const rf = fundingRoot.get(w);
        if (rf) {
          rootFunder = rf;
          break;
        }
      }
      return { index, rootFunder, wallets };
    });

  const clusterByAddr = new Map<string, number>();
  for (const c of sortedClusters) {
    for (const w of c.wallets) clusterByAddr.set(w, c.index);
  }

  // ── annotate funders + edge counts ──
  const edgeCount = new Map<string, number>();
  for (const edge of data.edges) {
    edgeCount.set(edge.a, (edgeCount.get(edge.a) ?? 0) + edge.transfers);
    edgeCount.set(edge.b, (edgeCount.get(edge.b) ?? 0) + edge.transfers);
  }

  for (const entry of baseEntries) {
    const ci = clusterByAddr.get(entry.address);
    if (ci !== undefined) {
      entry.clusterIndex = ci;
      entry.rootFunder = sortedClusters[ci].rootFunder || null;
    }
    const chain = data.chains[entry.address];
    const fundedBy = chain?.find((c) => c.fundedBy)?.fundedBy;
    // A wallet counts as "funded" if it has a direct funder via the chain
    // OR a cluster rootFunder. Without this fallback, clustered wallets
    // would show "Funded · 0" even though they have a known funding source.
    entry.funder = fundedBy ?? entry.rootFunder ?? null;
    entry.edgeCount = edgeCount.get(entry.address) ?? 0;
  }

  // ── compute base positions ──
  const cx = W / 2;
  const cy = H / 2;
  const ringR = Math.min(W, H) * 0.30;

  const nodes: Node[] = [];
  const nodeByAddr = new Map<string, Node>();

  // place clustered wallets around their cluster center.
  // Render every wallet the cluster API returns, even if it's not in the
  // top-N holder list (use placeholder rank/percentage). Prevents collapse
  // to a single point when most cluster members aren't in `holders`.
  const entryByAddr = new Map(baseEntries.map((e) => [e.address, e]));
  sortedClusters.forEach((cluster, ci) => {
    const angle =
      sortedClusters.length === 1
        ? 0
        : (ci / sortedClusters.length) * Math.PI * 2 - Math.PI / 2;
    const center = { x: cx + Math.cos(angle) * ringR, y: cy + Math.sin(angle) * ringR };
    cluster.wallets.forEach((address, wi) => {
      if (nodeByAddr.has(address)) return; // dedupe if address appears in multiple clusters
      const entry = entryByAddr.get(address);
      const n = Math.max(cluster.wallets.length, 1);
      const ring = Math.floor(wi / 10);
      const inRing = Math.min(n - ring * 10, 10);
      const localI = wi - ring * 10;
      const a =
        (Math.PI * 2 * localI) / Math.max(inRing, 1) +
        (hash(address) % 314) / 100 +
        ring * 0.32 +
        ci * 0.18;
      const dist = 90 + ring * 42 + Math.min(n, 20) * 2.4;
      const node: Node = {
        address,
        baseX: center.x + Math.cos(a) * dist,
        baseY: center.y + Math.sin(a) * dist,
        r: nodeRadius(entry?.percentage ?? 0, entry?.rank ?? 999),
        clusterIndex: ci,
        isLP: entry?.isLP ?? false,
        rank: entry?.rank ?? 0,
        percentage: entry?.percentage ?? 0,
      };
      nodes.push(node);
      nodeByAddr.set(address, node);
    });
  });

  // Pre-compute cluster halo footprints so unclustered wallets can be placed
  // outside them and repelled if they end up inside.
  type HaloDesc = { x: number; y: number; r: number };
  const haloDescs: HaloDesc[] = sortedClusters.map((cluster, ci) => {
    const ang =
      sortedClusters.length === 1
        ? 0
        : (ci / sortedClusters.length) * Math.PI * 2 - Math.PI / 2;
    const n = cluster.wallets.length;
    // mirror the cluster-wallet `dist` formula above so halo radius matches
    const maxRing = Math.max(0, Math.floor((n - 1) / 10));
    const maxDist = 90 + maxRing * 42 + Math.min(n, 20) * 2.4;
    return {
      x: cx + Math.cos(ang) * ringR,
      y: cy + Math.sin(ang) * ringR,
      r: maxDist + 64, // matches halo render (+60) plus small safety
    };
  });
  const maxHaloR = haloDescs.reduce((m, h) => Math.max(m, h.r), 0);

  // unclustered → golden-angle spiral spreads uniformly. Spiral starts past
  // the largest cluster halo so independents don't get placed inside one.
  const unclustered = baseEntries.filter((e) => e.clusterIndex === null);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const hasClusters = sortedClusters.length > 0;
  const baseOffset = hasClusters ? ringR + maxHaloR + 30 : 30;
  unclustered.forEach((entry, i) => {
    const a = i * goldenAngle + (hash(entry.address) % 100) / 600;
    const r = baseOffset + Math.sqrt(i + 1) * 36;
    const node: Node = {
      address: entry.address,
      baseX: cx + Math.cos(a) * r,
      baseY: cy + Math.sin(a) * r,
      r: nodeRadius(entry.percentage, entry.rank),
      clusterIndex: null,
      isLP: entry.isLP,
      rank: entry.rank,
      percentage: entry.percentage,
    };
    nodes.push(node);
    nodeByAddr.set(entry.address, node);
  });

  // Repulsion pass: push any unclustered node out of any cluster's halo.
  // (Defensive — the spiral starts beyond halos, but force-settle below can
  //  drift nodes back inward when many overlap.)
  const pushOutOfHalos = () => {
    for (const node of nodes) {
      if (node.clusterIndex !== null) continue;
      for (const h of haloDescs) {
        const dx = node.baseX - h.x;
        const dy = node.baseY - h.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const minD = h.r + node.r + 4;
        if (d < minD && d > 0.01) {
          const f = (minD - d) / d;
          node.baseX += dx * f;
          node.baseY += dy * f;
        } else if (d <= 0.01) {
          // exactly on cluster center — nudge outward arbitrarily
          node.baseX += h.r + node.r + 4;
        }
      }
    }
  };
  pushOutOfHalos();

  // ── force-settle to reduce overlap (one-shot, in base coords) ──
  for (let iter = 0; iter < 80; iter++) {
    if (iter % 8 === 7) pushOutOfHalos(); // keep unclustered out of halos
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.baseX - b.baseX;
        const dy = a.baseY - b.baseY;
        const d2 = dx * dx + dy * dy;
        const minD = a.r + b.r + 12;
        if (d2 < minD * minD && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = ((minD - d) / d) * 0.25;
          const fx = dx * f;
          const fy = dy * f;
          a.baseX += fx;
          a.baseY += fy;
          b.baseX -= fx;
          b.baseY -= fy;
        }
      }
    }
  }
  // final pass after settle — guarantees no unclustered node sits inside a halo
  pushOutOfHalos();
  pushOutOfHalos();

  // ── edges ──
  const edges: Edge[] = [];
  // synthetic funding-chain edges link wallets that share a funder (the cluster
  // API returns groups, not pairwise edges, so members are chained for visual
  // cohesion). Drawn only among genuine funding members — transfer links are
  // drawn separately below — but colored by the merged cluster they now sit in.
  for (const fc of data.clusters) {
    for (let i = 0; i < fc.wallets.length - 1; i++) {
      const a = fc.wallets[i];
      const b = fc.wallets[i + 1];
      if (!nodeByAddr.has(a) || !nodeByAddr.has(b)) continue;
      edges.push({
        id: `f:${a}:${b}`,
        from: a,
        to: b,
        kind: "funding",
        clusterIndex: clusterByAddr.get(a) ?? clusterByAddr.get(b) ?? null,
      });
    }
  }

  // direct holder transfer edges
  for (const edge of data.edges) {
    if (!nodeByAddr.has(edge.a) || !nodeByAddr.has(edge.b)) continue;
    edges.push({
      id: `t:${edge.a}:${edge.b}:${edge.kind}`,
      from: edge.a,
      to: edge.b,
      kind: "transfer",
      clusterIndex:
        clusterByAddr.get(edge.a) ?? clusterByAddr.get(edge.b) ?? null,
    });
  }

  // Surface cluster wallets that weren't in the original holder list so
  // they appear in the address list & metadata lookups.
  for (const cluster of sortedClusters) {
    for (const address of cluster.wallets) {
      if (entryByAddr.has(address)) continue;
      const entry: Entry = {
        address,
        rank: 0,
        percentage: 0,
        isLP: false,
        clusterIndex: cluster.index,
        rootFunder: cluster.rootFunder || null,
        funder: data.chains[address]?.find((c) => c.fundedBy)?.fundedBy ?? (cluster.rootFunder || null),
        edgeCount: edgeCount.get(address) ?? 0,
      };
      baseEntries.push(entry);
      entryByAddr.set(address, entry);
    }
  }
  // re-sort: known-rank holders first, then unranked cluster members
  baseEntries.sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));

  return { entries: baseEntries, nodes, edges, clusters: sortedClusters };
}

function nodeRadius(percentage: number, rank: number) {
  const pct = percentage > 0 ? Math.sqrt(percentage) * 5.4 : 0;
  const rankBoost = rank <= 3 ? 4 : rank <= 10 ? 2 : 0;
  return clamp(8 + pct + rankBoost, 8, 30);
}

function fitToBounds(
  nodes: Node[],
  positions: Map<string, { x: number; y: number }> | undefined,
  setVb: (vb: { x: number; y: number; w: number; h: number }) => void,
) {
  if (nodes.length === 0) {
    setVb({ x: 0, y: 0, w: W, h: H });
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const p = positions?.get(n.address) ?? { x: n.baseX, y: n.baseY };
    if (p.x - n.r < minX) minX = p.x - n.r;
    if (p.y - n.r < minY) minY = p.y - n.r;
    if (p.x + n.r > maxX) maxX = p.x + n.r;
    if (p.y + n.r > maxY) maxY = p.y + n.r;
  }
  const pad = 80;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  setVb({ x: minX - pad, y: minY - pad, w: bw, h: bh });
}

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function formatPct(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0.00%";
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

function labelKind(meta: Entry) {
  if (meta.isLP) return "Liquidity pool";
  if (meta.clusterIndex !== null) return `Cluster ${String.fromCharCode(65 + meta.clusterIndex)}`;
  if (meta.funder) return "Funded wallet";
  return "Independent";
}
