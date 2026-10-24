import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Bookmark, Bot, ChevronDown, Clock3, Database, FileText, FolderOpen,
  HardDrive, LayoutDashboard, LogOut, Menu, Plus, Search, Settings, Tag, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { loadSavedViews, storeSavedViews, type SavedView } from "../lib/library";
import type { Source } from "../lib/types";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const params = new URLSearchParams(location.search);
  const inLibrary = location.pathname === "/library";
  const sourceId = params.get("sourceId");
  const kind = params.get("kind");
  const selectedTag = params.get("tag");

  useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    let alive = true;
    void api.sources.list().then(value => {
      if (alive) { setSources(value.sources); setSourceError(false); }
    }).catch(() => { if (alive) setSourceError(true); });
    void api.tags.list().then(value => { if (alive) setTags(value.tags); }).catch(() => undefined);
    return () => { alive = false; };
  }, [location.pathname]);
  useEffect(() => {
    const load = () => setSaved(user ? loadSavedViews(user.id) : []);
    load();
    window.addEventListener("kb:views-changed", load);
    window.addEventListener("storage", load);
    return () => { window.removeEventListener("kb:views-changed", load); window.removeEventListener("storage", load); };
  }, [user?.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || target.isContentEditable) return;
      if (event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        if (window.innerWidth < 1024) setMobileOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const total = sources.reduce((count, source) => count + source.docCount, 0);
  const recent = () => {
    const date = new Date(); date.setDate(date.getDate() - 7);
    navigate("/library?from=" + date.toISOString().slice(0, 10) + "&sort=newest");
  };
  const sidebar = (
    <div className="reader-sidebar">
      <Link to="/library" className="reader-brand">
        <span className="reader-brand-icon"><BookOpen size={20} strokeWidth={2.1} /></span>
        <span>知屿<span className="reader-brand-caption">你的知识，随时可用</span></span>
      </Link>
      <form className="rail-search" onSubmit={event => {
        event.preventDefault();
        navigate("/library" + (search.trim() ? "?q=" + encodeURIComponent(search.trim()) : ""));
        setSearch("");
      }}>
        <Search size={15} />
        <input ref={searchRef} aria-label="全局搜索" placeholder="搜索你的知识" value={search}
          onChange={event => setSearch(event.target.value)} />
        <kbd>/</kbd>
      </form>
      <div className="rail-scroll">
        <div className="rail-label">资料库</div>
        <nav aria-label="资料库导航">
          <Link className={"rail-link " + (inLibrary && !kind && !sourceId && !selectedTag && !params.get("from") ? "active" : "")} to="/library">
            <FolderOpen size={16} /><span>全部文档</span><small>{total}</small>
          </Link>
          <Link className={"rail-link " + (inLibrary && kind === "article" ? "active" : "")} to="/library?kind=article">
            <BookOpen size={16} /><span>文章</span>
          </Link>
          <Link className={"rail-link " + (inLibrary && kind === "file" ? "active" : "")} to="/library?kind=file">
            <FileText size={16} /><span>专业文件</span>
          </Link>
          <button className={"rail-link " + (inLibrary && params.get("from") && !sourceId ? "active" : "")} onClick={recent}>
            <Clock3 size={16} /><span>最近 7 天</span>
          </button>
          <NavLink className={({ isActive }) => "rail-link " + (isActive ? "active" : "")} to="/chat">
            <Bot size={16} /><span>AI 会话</span>
          </NavLink>
        </nav>
        <div className="rail-label rail-section-label"><span>信息来源</span><Link to="/sources" aria-label="添加信息来源"><Plus size={14} /></Link></div>
        <nav aria-label="按来源浏览">
          {sources.map(source => (
            <Link key={source.id} to={"/library?sourceId=" + encodeURIComponent(source.id)}
              className={"rail-link " + (inLibrary && sourceId === source.id ? "active" : "")}>
              {source.type === "smb" || source.type === "local" ? <HardDrive size={16} /> : <BookOpen size={16} />}
              <span title={source.name}>{source.name}</span>
              <small>{source.docCount}</small>
            </Link>
          ))}
          {!sources.length && <Link className="rail-link rail-empty" to="/sources"><Plus size={15} /><span>{sourceError ? "查看来源连接" : "连接你的第一个来源"}</span></Link>}
        </nav>
        {saved.length > 0 && <>
          <div className="rail-label rail-section-label">保存的筛选</div>
          <nav aria-label="保存的筛选">{saved.map(view => <div className="rail-saved" key={view.id}>
            <Link className="rail-link" to={"/library?" + view.query}><Bookmark size={15} /><span>{view.name}</span></Link>
            <button className="rail-remove" aria-label={"删除筛选 " + view.name} onClick={() => {
              if (user) { try { storeSavedViews(user.id, saved.filter(item => item.id !== view.id)); } catch { /* Storage may be disabled. */ } }
            }}><X size={12} /></button>
          </div>)}</nav>
        </>}
        {tags.length > 0 && <>
          <div className="rail-label rail-section-label">标签</div>
          <nav aria-label="按标签浏览">{(tagsExpanded ? tags : tags.slice(0, 6)).map(item => (
            <Link key={item.tag} to={"/library?tag=" + encodeURIComponent(item.tag)}
              className={"rail-link " + (inLibrary && selectedTag === item.tag ? "active" : "")}>
              <Tag size={14} /><span>{item.tag}</span><small>{item.count}</small>
            </Link>
          ))}</nav>
          {tags.length > 6 && <button className="rail-more" onClick={() => setTagsExpanded(value => !value)}>
            <ChevronDown size={13} className={tagsExpanded ? "rotate-180" : ""} />{tagsExpanded ? "收起标签" : "查看全部标签"}
          </button>}
        </>}
      </div>
      <div className="rail-bottom">
        <NavLink to="/sources" className={({ isActive }) => "rail-link " + (isActive ? "active" : "")}><Database size={16} /><span>管理来源</span></NavLink>
        <NavLink to="/overview" className={({ isActive }) => "rail-link " + (isActive ? "active" : "")}><LayoutDashboard size={16} /><span>同步总览</span></NavLink>
        <NavLink to="/settings" className={({ isActive }) => "rail-link " + (isActive ? "active" : "")}><Settings size={16} /><span>设置</span></NavLink>
        <div className="rail-account">
          <span className="rail-avatar">{(user?.displayName || user?.username || "U").slice(0, 1).toUpperCase()}</span>
          <div><strong>{user?.displayName || user?.username}</strong><small>个人知识空间</small></div>
          <button aria-label="退出登录" title="退出登录" onClick={() => void logout()}><LogOut size={15} /></button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="app-reader-shell">
      <aside className="desktop-rail">{sidebar}</aside>
      {mobileOpen && <div className="mobile-rail-layer" role="dialog" aria-modal="true" aria-label="导航菜单">
        <button className="mobile-rail-scrim" aria-label="收起导航" onClick={() => setMobileOpen(false)} />
        <div className="mobile-rail">{sidebar}<button className="mobile-rail-close" aria-label="关闭导航" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      </div>}
      <div className="app-reader-main">
        <div className="mobile-topbar"><button aria-label="打开导航" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><Link to="/library"><BookOpen size={18} />知屿</Link><Link to="/sources" aria-label="管理来源"><Plus size={19} /></Link></div>
        <main><Outlet /></main>
      </div>
    </div>
  );
}
