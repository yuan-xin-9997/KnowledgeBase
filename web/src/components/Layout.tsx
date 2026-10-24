import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Bot,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

const navItems = [
  { to: "/", label: "总览", icon: LayoutDashboard, end: true },
  { to: "/library", label: "知识库", icon: BookOpen, end: false },
  { to: "/chat", label: "AI 会话", icon: Bot, end: false },
  { to: "/sources", label: "信息来源", icon: Database, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = search.trim();
    if (!value) return;
    navigate(`/library?q=${encodeURIComponent(value)}`);
    setSearch("");
  };

  const sidebar = (
    <div className="sidebar flex h-full w-[252px] flex-col">
      <div className="flex items-center gap-3 px-6 pb-7 pt-7">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#3a3f48] bg-[#1f242c]">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden>
            <path
              d="M6 24V10l10 6.5L26 10v14"
              stroke="#c9a86a"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
            <path d="M6 24h20" stroke="#6b6558" strokeWidth="1.4" />
          </svg>
        </div>
        <div>
          <div className="font-display text-[19px] font-semibold tracking-wide text-[#f0e8d8]">
            知屿
          </div>
          <div className="text-[10px] tracking-[0.18em] text-[#6f6a5f]">KNOWLEDGE ISLE</div>
        </div>
      </div>

      <div className="px-4">
        <form onSubmit={submitSearch} className="relative mb-6">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6f6a5f]"
          />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索知识库  /"
            className="w-full rounded-lg border border-[#2b3038] bg-[#1a1e25] py-2 pl-8 pr-3 text-[12.5px] text-[#d8d3c7] placeholder:text-[#5f5b52] focus:border-[#5c5342] focus:outline-none"
          />
        </form>

        <div className="sidebar-label">Workspace</div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto px-4 pb-5">
        <div className="rounded-xl border border-[#2b3038] bg-[#191d24] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2b3038] text-[12px] font-semibold text-[#e4d8c2]">
              {(user?.displayName || user?.username || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[#e6dfd1]">
                {user?.displayName || user?.username}
              </div>
              <div className="truncate text-[11px] text-[#6f6a5f]">{user?.email}</div>
            </div>
            <button
              onClick={() => void logout()}
              title="退出登录"
              className="rounded-md p-1.5 text-[#7b7467] transition hover:bg-[#262b33] hover:text-[#e6dfd1]"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between px-1 text-[10px] text-[#57534b]">
          <span>v1.0</span>
          <button
            className="hover:text-[#a8a396]"
            onClick={() => void api.auth.me().catch(() => undefined)}
          >
            个人知识中枢
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[var(--paper)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0">
            {sidebar}
            <button
              className="absolute right-3 top-3 rounded-md p-2 text-[#8b8477] hover:bg-[#22272f]"
              onClick={() => setMobileOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 lg:pl-[252px]">
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--paper)]/90 px-4 backdrop-blur lg:hidden">
          <button
            className="rounded-lg border border-[var(--line-strong)] p-2"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={17} />
          </button>
          <span className="font-display text-lg font-semibold">知屿</span>
        </div>
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
