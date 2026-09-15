// bb-plugin-swipe-threads — subtle bottom back/forward for visit history.
// No swipe gestures. Tap-only controls under the composer.
// History covers every screen: threads, compose, settings, plugin panels, …
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  type BbNavigate,
} from "@get-bb/plugin-sdk/app";

const STACK_KEY = "bb-swipe-visit-stack-v2";
const INDEX_KEY = "bb-swipe-visit-index-v2";
const LEGACY_STACK_KEY = "bb-swipe-visit-stack-v1";
const LEGACY_INDEX_KEY = "bb-swipe-visit-index-v1";
const COOLDOWN_MS = 280;
const MAX_STACK = 80;

type StackState = { stack: string[]; index: number };

function readPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Visit keys: `t:<threadId>` or `p:<pathname+search>`. */
function visitKey(threadId: string | null, path: string): string {
  if (threadId) return `t:${threadId}`;
  return `p:${path || "/"}`;
}

function normalizeStoredKey(raw: string): string {
  if (raw.startsWith("t:") || raw.startsWith("p:")) return raw;
  // v1 stored bare thread ids.
  if (raw.startsWith("thr_")) return `t:${raw}`;
  return `p:${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function readStack(): StackState {
  try {
    const stackRaw =
      sessionStorage.getItem(STACK_KEY) ??
      sessionStorage.getItem(LEGACY_STACK_KEY);
    const indexRaw =
      sessionStorage.getItem(INDEX_KEY) ??
      sessionStorage.getItem(LEGACY_INDEX_KEY);
    const parsed = stackRaw ? (JSON.parse(stackRaw) as unknown) : [];
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      return { stack: [], index: -1 };
    }
    const stack = parsed.map(normalizeStoredKey);
    const index = indexRaw !== null ? Number(indexRaw) : stack.length - 1;
    if (!Number.isFinite(index)) return { stack, index: stack.length - 1 };
    return { stack, index };
  } catch {
    return { stack: [], index: -1 };
  }
}

function writeStack(state: StackState): void {
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(state.stack));
    sessionStorage.setItem(INDEX_KEY, String(state.index));
  } catch {
    // ignore quota / private mode
  }
}

const locationListeners = new Set<() => void>();
let historyPatched = false;

function ensureLocationPatch(): void {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  const notify = () => {
    for (const listener of locationListeners) listener();
  };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      const result = original(...args);
      queueMicrotask(notify);
      return result;
    };
  }
  window.addEventListener("popstate", notify);
}

function subscribeLocation(listener: () => void): () => void {
  ensureLocationPatch();
  locationListeners.add(listener);
  return () => {
    locationListeners.delete(listener);
  };
}

function useLocationPath(): string {
  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : readPath(),
  );
  useEffect(() => {
    const sync = () => setPath(readPath());
    sync();
    return subscribeLocation(sync);
  }, []);
  return path;
}

function goToVisit(key: string, navigate: BbNavigate): void {
  if (key.startsWith("t:")) {
    const id = key.slice(2);
    if (id) navigate.toThread(id);
    return;
  }
  if (!key.startsWith("p:")) return;
  const path = key.slice(2) || "/";
  if (path === "/" || path === "") {
    navigate.toCompose();
    return;
  }
  if (readPath() === path) return;
  // Cross-surface SPA nav (same trick as Agent Board): push + popstate.
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Matches BB shell padding (`pb-[var(--bb-safe-area-bottom,…)]`). */
const BB_SAFE_AREA_BOTTOM = "--bb-safe-area-bottom";
const INSET_STYLE_ID = "bb-visit-history-bar-inset";
/** Full bar box; tucked down so only a slim strip shows (original size). */
const BAR_CHROME_PX = 48;
const BAR_TUCK_PX = 40;
const BAR_HEIGHT_CSS = `calc(${BAR_CHROME_PX}px + env(safe-area-inset-bottom, 0px))`;
/** Visible overlap above the viewport bottom — what content must clear. */
const BAR_INSET_CSS = `calc(${BAR_CHROME_PX - BAR_TUCK_PX}px + env(safe-area-inset-bottom, 0px))`;

const barStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  // Tuck under the viewport so the bar stays the previous slim size.
  bottom: -BAR_TUCK_PX,
  // Below BB drawers/dialogs (z-50) so Options / pickers cover the bar flush to the screen edge.
  zIndex: 40,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
  gap: 0,
  height: BAR_HEIGHT_CSS,
  padding: 0,
  margin: 0,
  background: "#ffffff",
  borderTop: "1px solid rgba(0,0,0,0.08)",
  pointerEvents: "auto",
};

/**
 * Clear the bar for in-flow chrome (compose / threads). Overlays keep bottom:0
 * and paint above the bar via z-index, so they stay flush to the screen edge.
 */
function useVisitBarInset(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.style.setProperty(BB_SAFE_AREA_BOTTOM, BAR_INSET_CSS);

    let style = document.getElementById(INSET_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = INSET_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = `
      /* Shell already uses --bb-safe-area-bottom; remap raw env() utilities too. */
      .pb-\\[env\\(safe-area-inset-bottom\\)\\] {
        padding-bottom: var(${BB_SAFE_AREA_BOTTOM}, env(safe-area-inset-bottom)) !important;
      }
      .pb-\\[max\\(0\\.5rem\\,env\\(safe-area-inset-bottom\\)\\)\\] {
        padding-bottom: max(0.5rem, var(${BB_SAFE_AREA_BOTTOM}, env(safe-area-inset-bottom))) !important;
      }
      .pb-\\[max\\(1rem\\,env\\(safe-area-inset-bottom\\)\\)\\] {
        padding-bottom: max(1rem, var(${BB_SAFE_AREA_BOTTOM}, env(safe-area-inset-bottom))) !important;
      }
      .max-md\\:pb-\\[max\\(1rem\\,env\\(safe-area-inset-bottom\\)\\)\\] {
        padding-bottom: max(1rem, var(${BB_SAFE_AREA_BOTTOM}, env(safe-area-inset-bottom))) !important;
      }
      @media (min-width: 640px) {
        .sm\\:pb-\\[max\\(1\\.5rem\\,env\\(safe-area-inset-bottom\\)\\)\\] {
          padding-bottom: max(1.5rem, var(${BB_SAFE_AREA_BOTTOM}, env(safe-area-inset-bottom))) !important;
        }
      }
    `;

    return () => {
      root.style.removeProperty(BB_SAFE_AREA_BOTTOM);
      style?.remove();
    };
  }, [active]);
}

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      // Same threshold BB uses when collapsing safe-area for the keyboard.
      setOpen(window.innerHeight - vv.height >= 80);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  return open;
}

const AGENT_BOARD_PATH = "/plugins/agent-board/operations";

function openAgentBoard(): void {
  const link = document.querySelector<HTMLAnchorElement>(
    `a[href="${AGENT_BOARD_PATH}"], a[href^="${AGENT_BOARD_PATH}?"]`,
  );
  if (link) {
    link.click();
    return;
  }
  // Cross-plugin nav isn't on useBbNavigate; ride the SPA router via history.
  window.history.pushState({}, "", AGENT_BOARD_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navBtn(
  disabled: boolean,
  opts: { borderRight?: boolean; fontSize?: number } = {},
): CSSProperties {
  return {
    appearance: "none",
    WebkitAppearance: "none",
    flex: 1,
    margin: 0,
    minWidth: 0,
    height: "100%",
    borderRadius: 0,
    border: "none",
    borderRight: opts.borderRight ? "1px solid rgba(0,0,0,0.06)" : "none",
    background: "#ffffff",
    color: disabled ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.55)",
    font: `600 ${opts.fontSize ?? 22}px/1 system-ui, sans-serif`,
    paddingTop: 8,
    paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "default" : "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  };
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(max-width: 767px)").matches ||
      window.matchMedia("(pointer: coarse)").matches
    );
  });
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 767px)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const sync = () => setMobile(narrow.matches || coarse.matches);
    sync();
    narrow.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    return () => {
      narrow.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
    };
  }, []);
  return mobile;
}

function VisitHistoryBar() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const path = useLocationPath();
  const isMobile = useIsMobile();
  const keyboardOpen = useKeyboardOpen();
  const showBar = isMobile && !keyboardOpen;
  const [state, setState] = useState<StackState>(() => readStack());
  const skipPushRef = useRef(false);
  const cooldownRef = useRef(0);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const current = visitKey(threadId, path);

  useVisitBarInset(showBar);

  useEffect(() => {
    if (skipPushRef.current) {
      skipPushRef.current = false;
      return;
    }
    setState((prev) => {
      const cur = prev.stack[prev.index];
      if (cur === current) return prev;
      const stack = [...prev.stack.slice(0, prev.index + 1), current].slice(
        -MAX_STACK,
      );
      const next = { stack, index: stack.length - 1 };
      writeStack(next);
      return next;
    });
  }, [current]);

  // Mobile / coarse-pointer only — every surface (threads, compose, boards, settings).
  // Hide while the software keyboard is up so it doesn't fight the composer.
  if (!showBar) return null;

  const onStackIndex =
    state.index >= 0 && state.stack[state.index] === current
      ? state.index
      : state.stack.lastIndexOf(current);
  const canBack =
    onStackIndex > 0 || (onStackIndex < 0 && state.stack.length > 0);
  const canForward =
    onStackIndex >= 0 && onStackIndex < state.stack.length - 1;

  const go = (kind: "back" | "forward") => {
    const now = performance.now();
    if (now < cooldownRef.current) return;
    setState((prev) => {
      let fromIndex = prev.index;
      const at = prev.stack.lastIndexOf(current);
      if (at >= 0) {
        fromIndex = at;
      } else if (kind === "back") {
        // Off-stack: treat as "past the tip" so Back lands on the latest visit.
        fromIndex = prev.stack.length;
      } else {
        return prev;
      }

      const nextIndex = kind === "back" ? fromIndex - 1 : fromIndex + 1;
      if (nextIndex < 0 || nextIndex >= prev.stack.length) return prev;
      const key = prev.stack[nextIndex];
      if (!key) return prev;
      cooldownRef.current = now + COOLDOWN_MS;
      skipPushRef.current = true;
      const next = { stack: prev.stack, index: nextIndex };
      writeStack(next);
      goToVisit(key, navigateRef.current);
      return next;
    });
  };

  return (
    <div style={barStyle} role="navigation" aria-label="Visit history">
      <button
        type="button"
        aria-label="Go back"
        disabled={!canBack}
        style={navBtn(!canBack, { borderRight: true })}
        onClick={() => go("back")}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Open Agent Board"
        style={navBtn(false, { borderRight: true, fontSize: 13 })}
        onClick={() => openAgentBoard()}
      >
        Board
      </button>
      <button
        type="button"
        aria-label="Go forward"
        disabled={!canForward}
        style={navBtn(!canForward)}
        onClick={() => go("forward")}
      >
        →
      </button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "visit-history-bar",
    component: VisitHistoryBar,
  });
});
