// bb-plugin-swipe-threads — subtle bottom back/forward for visit history.
// No swipe gestures. Tap-only controls under the composer.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";

const STACK_KEY = "bb-swipe-visit-stack-v1";
const INDEX_KEY = "bb-swipe-visit-index-v1";
const COOLDOWN_MS = 280;

type StackState = { stack: string[]; index: number };

function readStack(): StackState {
  try {
    const stackRaw = sessionStorage.getItem(STACK_KEY);
    const indexRaw = sessionStorage.getItem(INDEX_KEY);
    const stack = stackRaw ? (JSON.parse(stackRaw) as unknown) : [];
    const index = indexRaw !== null ? Number(indexRaw) : -1;
    if (!Array.isArray(stack) || !stack.every((x) => typeof x === "string")) {
      return { stack: [], index: -1 };
    }
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

const barStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  // 40px lower so we clear the follow-up composer.
  bottom: -40,
  zIndex: 2147483000,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
  gap: 0,
  height: "calc(48px + env(safe-area-inset-bottom, 0px))",
  padding: 0,
  margin: 0,
  background: "#ffffff",
  borderTop: "1px solid rgba(0,0,0,0.08)",
  pointerEvents: "auto",
};

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
  const isMobile = useIsMobile();
  const [state, setState] = useState<StackState>(() => readStack());
  const skipPushRef = useRef(false);
  const cooldownRef = useRef(0);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (threadId === null) return;
    if (skipPushRef.current) {
      skipPushRef.current = false;
      return;
    }
    setState((prev) => {
      const cur = prev.stack[prev.index];
      if (cur === threadId) return prev;
      const stack = [...prev.stack.slice(0, prev.index + 1), threadId].slice(-80);
      const next = { stack, index: stack.length - 1 };
      writeStack(next);
      return next;
    });
  }, [threadId]);

  // Mobile / coarse-pointer only — every surface (threads, compose, boards, settings).
  if (!isMobile) return null;

  const onStackIndex =
    threadId === null ? -1 : state.stack.lastIndexOf(threadId);
  // Off-thread surfaces (compose / Board / settings): Back returns to the
  // latest visited thread if we have any history.
  const canBack =
    threadId === null ? state.stack.length > 0 : onStackIndex > 0;
  const canForward =
    onStackIndex >= 0 && onStackIndex < state.stack.length - 1;

  const go = (kind: "back" | "forward") => {
    const now = performance.now();
    if (now < cooldownRef.current) return;
    setState((prev) => {
      // If we're off-stack (Board/settings/compose), Back jumps to the latest
      // visited thread; Forward is unused until you've gone Back from a thread.
      let fromIndex = prev.index;
      if (threadId !== null) {
        const at = prev.stack.indexOf(threadId);
        if (at >= 0) fromIndex = at;
      } else if (kind === "back") {
        // Already "past" the tip — go to tip (most recent thread).
        fromIndex = prev.index + 1;
      }

      const nextIndex = kind === "back" ? fromIndex - 1 : fromIndex + 1;
      if (nextIndex < 0 || nextIndex >= prev.stack.length) return prev;
      const id = prev.stack[nextIndex];
      if (!id) return prev;
      cooldownRef.current = now + COOLDOWN_MS;
      skipPushRef.current = true;
      const next = { stack: prev.stack, index: nextIndex };
      writeStack(next);
      navigateRef.current.toThread(id);
      return next;
    });
  };

  return (
    <div style={barStyle} role="navigation" aria-label="Thread history">
      <button
        type="button"
        aria-label="Previous thread"
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
        aria-label="Next thread"
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
