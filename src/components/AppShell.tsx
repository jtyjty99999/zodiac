"use client";

import {
  Boxes,
  CalendarDays,
  GitCommitHorizontal,
  GitCompare,
  Grid3X3,
  Inbox,
  Layers,
  LayoutDashboard,
  Menu,
  Orbit,
  Server,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import ThemeToggle from "./ThemeToggle";

const NAV = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/features", label: "功能矩阵", icon: Grid3X3 },
  { href: "/compare", label: "实现对比", icon: GitCompare },
  { href: "/daily", label: "日更归档", icon: CalendarDays },
  { href: "/commits", label: "提交与发版", icon: GitCommitHorizontal },
  { href: "/candidates", label: "新功能候选", icon: Inbox },
  { href: "/harnesses", label: "Harness 管理", icon: Boxes },
  { href: "/baseline", label: "基线版本", icon: Layers },
  { href: "/settings", label: "设置", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen lg:flex">
      <div
        className={`fixed inset-0 z-30 bg-black/45 backdrop-blur-sm lg:hidden ${open ? "" : "hidden"}`}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-surface/95 backdrop-blur-xl transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-6">
          <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-accent to-cyan text-white shadow-lg shadow-accent/30">
              <Orbit size={20} />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-wide">Zodiac</span>
              <span className="block text-[11px] text-muted">Agent Harness Tracker</span>
            </span>
          </Link>
          <button
            type="button"
            className="btn btn-ghost p-1.5 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="关闭菜单"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  active
                    ? "bg-accent-soft font-medium text-ink"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <Icon size={16} className={active ? "text-accent" : ""} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-line px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">外观</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <Server size={12} />
            本地运行 · SQLite
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/80 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            className="btn p-2"
            onClick={() => setOpen(true)}
            aria-label="打开菜单"
          >
            <Menu size={16} />
          </button>
          <span className="flex items-center gap-2 text-sm font-medium">
            <Orbit size={15} className="text-accent" />
            Zodiac
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
