const fs = require('fs');
const path = require('path');

const code = `"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard, Users, Receipt, MessageSquareWarning,
  Megaphone, UserCheck, CalendarDays, Settings, LogOut, Menu, X,
  Bell, BarChart3, Globe, ChevronRight, Sparkles, ShieldCheck, CalendarClock,
  FileSpreadsheet, Fingerprint, BookOpen, ClipboardList, User, Moon, Sun,
  Home as HomeIcon, Car, MessageSquare, Vote, Wrench, FolderOpen, HardHat,
  ShieldAlert, QrCode, Phone, Package, Download, LayoutGrid, ChevronLeft
} from "lucide-react";
import { getInitials } from "@/lib/utils";
import { useLocale } from "@/context/LocaleContext";
import { useTheme } from "@/context/ThemeContext";
import { scrollerAPI } from "@/lib/api";
import api from "@/lib/api";

const normalizeRole = (role: string) =>
  String(role || "")
    .trim()
    .toUpperCase()
    .replace(/[\\s-]+/g, "_");

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT","PLATFORM_ADMIN","MAKER","CHECKER","GUARD"], section: "main" },
  { href: "/dashboard/members", label: "Members", icon: Users, roles: ["ADMIN","TREASURER","COMMITTEE"], section: "management" },
  { href: "/dashboard/properties", label: "Properties Setup", icon: Wrench, roles: ["ADMIN"], section: "management" },
  { href: "/dashboard/vehicles", label: "Vehicles & Parking", icon: Car, roles: ["ADMIN","COMMITTEE","RESIDENT"], section: "management" },
  { href: "/dashboard/billing", label: "Billing & Payments", icon: Receipt, roles: ["ADMIN","TREASURER","MAKER","CHECKER","RESIDENT","COMMITTEE"], section: "management" },
  { href: "/dashboard/complaints", label: "Complaints", icon: MessageSquareWarning, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT"], section: "management" },
  { href: "/dashboard/notices", label: "Notices", icon: Megaphone, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT","GUARD","MAKER","CHECKER"], section: "management" },
  { href: "/dashboard/visitors", label: "Visitors", icon: UserCheck, roles: ["ADMIN","COMMITTEE","RESIDENT","GUARD"], section: "management" },
  { href: "/dashboard/staff", label: "Staff Attendance", icon: HardHat, roles: ["ADMIN","COMMITTEE"], section: "management" },
  { href: "/dashboard/facilities", label: "Facilities", icon: CalendarDays, roles: ["ADMIN","COMMITTEE","TREASURER","RESIDENT"], section: "management" },
  { href: "/dashboard/scrollers", label: "Scrollers", icon: Globe, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT","PLATFORM_ADMIN"], section: "communication" },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT","PLATFORM_ADMIN"], section: "communication" },
  { href: "/dashboard/meetings", label: "Meetings & Polls", icon: Vote, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT"], section: "communication" },
  { href: "/dashboard/vendors", label: "Vendors", icon: Wrench, roles: ["ADMIN","COMMITTEE","TREASURER","RESIDENT"], section: "maintenance" },
  { href: "/dashboard/documents", label: "Documents", icon: FolderOpen, roles: ["ADMIN","TREASURER","COMMITTEE","MAKER","CHECKER"], section: "maintenance" },
  { href: "/dashboard/assets", label: "Asset Management", icon: Package, roles: ["ADMIN","COMMITTEE","TREASURER"], section: "maintenance" },
  { href: "/dashboard/sos", label: "SOS Alerts", icon: ShieldAlert, roles: ["ADMIN","COMMITTEE","TREASURER","RESIDENT","GUARD"], section: "security" },
  { href: "/dashboard/patrol", label: "Guard Patrolling", icon: QrCode, roles: ["ADMIN","COMMITTEE","GUARD"], section: "security" },
  { href: "/dashboard/emergency-contacts", label: "Emergency Contacts", icon: Phone, roles: ["ADMIN","COMMITTEE","TREASURER","RESIDENT","GUARD","MAKER","CHECKER"], section: "security" },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN","TREASURER","COMMITTEE","PLATFORM_ADMIN"], section: "analytics" },
  { href: "/dashboard/reports/export", label: "Export Data", icon: Download, roles: ["ADMIN","TREASURER","COMMITTEE","PLATFORM_ADMIN"], section: "analytics" },
  { href: "/dashboard/tax", label: "Tax & Returns", icon: FileSpreadsheet, roles: ["ADMIN","TREASURER"], section: "analytics" },
  { href: "/dashboard/compliance", label: "Compliance Calendar", icon: CalendarClock, roles: ["ADMIN","TREASURER","COMMITTEE"], section: "analytics" },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell, roles: ["ADMIN","TREASURER","COMMITTEE"], section: "analytics" },
  { href: "/dashboard/accounting", label: "Accounting", icon: BookOpen, roles: ["ADMIN","TREASURER","MAKER","CHECKER","COMMITTEE"], section: "analytics" },
  { href: "/dashboard/audit", label: "Audit Trail", icon: ClipboardList, roles: ["ADMIN","TREASURER","CHECKER","COMMITTEE"], section: "analytics" },
  { href: "/dashboard/platform-admin", label: "Platform Admin", icon: Globe, roles: ["PLATFORM_ADMIN"], section: "settings" },
  { href: "/dashboard/societies", label: "Societies & Plans", icon: LayoutGrid, roles: ["PLATFORM_ADMIN"], section: "settings" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, roles: ["ADMIN","PLATFORM_ADMIN"], section: "settings" },
  { href: "/dashboard/settings/rbac", label: "Role Management", icon: ShieldCheck, roles: ["ADMIN"], section: "settings" },
  { href: "/dashboard/privacy", label: "Privacy & Consent", icon: Fingerprint, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT","PLATFORM_ADMIN","MAKER","CHECKER","GUARD"], section: "settings" },
  { href: "/dashboard/profile", label: "My Profile", icon: User, roles: ["ADMIN","TREASURER","COMMITTEE","RESIDENT","PLATFORM_ADMIN","MAKER","CHECKER","GUARD"], section: "settings" },
];

const sectionConfig: Record<string, { label: string; color: string }> = {
  main:          { label: "",                  color: "" },
  management:    { label: "Management",        color: "text-blue-400" },
  communication: { label: "Communication",     color: "text-emerald-400" },
  maintenance:   { label: "Maintenance",       color: "text-amber-400" },
  security:      { label: "Security & Safety", color: "text-rose-400" },
  analytics:     { label: "Analytics",         color: "text-violet-400" },
  settings:      { label: "System",            color: "text-slate-400" },
};

const roleInfo: Record<string, { label: string; color: string; bg: string; gradient: string }> = {
  ADMIN:          { label: "Administrator",    color: "text-indigo-300",  bg: "bg-indigo-500/20",  gradient: "from-indigo-500 to-purple-600" },
  TREASURER:      { label: "Treasurer",        color: "text-emerald-300", bg: "bg-emerald-500/20", gradient: "from-emerald-500 to-teal-600" },
  COMMITTEE:      { label: "Committee",        color: "text-blue-300",    bg: "bg-blue-500/20",    gradient: "from-blue-500 to-cyan-600" },
  RESIDENT:       { label: "Resident",         color: "text-orange-300",  bg: "bg-orange-500/20",  gradient: "from-orange-400 to-rose-500" },
  PLATFORM_ADMIN: { label: "Platform Admin",   color: "text-violet-300",  bg: "bg-violet-500/20",  gradient: "from-violet-600 to-fuchsia-600" },
  GUARD:          { label: "Guard",            color: "text-slate-300",   bg: "bg-slate-500/20",   gradient: "from-slate-500 to-gray-600" },
  MAKER:          { label: "Treasury Maker",   color: "text-cyan-300",    bg: "bg-cyan-500/20",    gradient: "from-cyan-500 to-blue-600" },
  CHECKER:        { label: "Treasury Checker", color: "text-teal-300",    bg: "bg-teal-500/20",    gradient: "from-teal-500 to-emerald-600" },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, logout, loading, isAuthenticated, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const userRole = normalizeRole(user?.role || "");

  const [scrollers, setScrollers] = useState<any[]>([]);
  const [renewalBanner, setRenewalBanner] = useState<any>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    scrollerAPI.getActive({}).then(res => setScrollers(res.data?.scrollers || [])).catch(() => {});
    api.get('/notifications/v4/renewal-banner').then(res => setRenewalBanner(res.data?.banner || null)).catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.push("/login");
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (loading || !isAuthenticated || !pathname) return;
    const allowed = navItems.some((item) => {
      const allowedRoles = item.roles.map(normalizeRole);
      if (!allowedRoles.includes(userRole)) return false;
      if (item.href === "/dashboard") return pathname === "/dashboard";
      return pathname === item.href || pathname.startsWith(item.href + "/");
    });
    if (!allowed) router.replace("/dashboard");
  }, [loading, isAuthenticated, pathname, router, userRole]);

  const filteredNav = useMemo(
    () => navItems.filter(item => item.roles.map(normalizeRole).includes(userRole)),
    [userRole]
  );

  const handleLogout = () => { logout(); router.push("/login"); };

  const isActive = useCallback((href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }, [pathname]);

  const groupedNav = useMemo(() =>
    filteredNav.reduce((acc, item) => {
      if (!acc[item.section]) acc[item.section] = [];
      acc[item.section].push(item);
      return acc;
    }, {} as Record<string, typeof navItems>),
    [filteredNav]
  );

  const currentRoleInfo = roleInfo[userRole] || roleInfo.RESIDENT;

  if (loading || !isAuthenticated) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-mesh overflow-hidden relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/20 blur-[100px] rounded-full animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-purple-500/20 blur-[80px] rounded-full animate-pulse" style={{ animationDuration: '3s', animationDelay: '1s' }} />
        <div className="relative z-10 flex flex-col items-center gap-8 animate-fade-in">
          <div className="relative flex items-center justify-center w-28 h-28">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100 border-t-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.3)] animate-[spin_3s_linear_infinite]" />
            <div className="absolute inset-3 rounded-full border-4 border-purple-100 border-b-purple-600 shadow-[0_0_10px_rgba(147,51,234,0.3)] animate-[spin_2s_linear_infinite_reverse]" />
            <div className="animate-pulse bg-white p-3 rounded-full shadow-xl">
              <Logo size="md" showText={false} />
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <h2 className="text-2xl font-extrabold bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-600 bg-[length:200%_auto] bg-clip-text text-transparent animate-[shimmer_2.5s_linear_infinite]">
              AapkiSociety
            </h2>
            <div className="flex items-center gap-3 bg-white/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/60 shadow-sm">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce shadow-sm" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce shadow-sm" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce shadow-sm" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="text-sm font-semibold text-slate-600 tracking-wide">Preparing your experience...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-mesh">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-40 lg:hidden animate-fade-in" onClick={() => setSidebarOpen(false)} />
      )}

      {/* SIDEBAR */}
      <aside
        className={\`fixed lg:static inset-y-0 left-0 z-50 flex flex-col \${sidebarCollapsed ? 'lg:w-[72px] w-72' : 'w-72'} h-full transition-all duration-300 ease-in-out \${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}\`}
        style={{ background: 'linear-gradient(170deg, #0d1117 0%, #0f172a 40%, #0a0f1e 100%)', boxShadow: '4px 0 60px rgba(0,0,0,0.5), inset -1px 0 0 rgba(255,255,255,0.05)' }}
      >
        {/* Logo Header */}
        <div className="relative flex items-center gap-3 px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
          <div className="relative shrink-0">
            <Logo size="sm" showText={false} href="/dashboard" />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[#0d1117] shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          </div>
          <div className={\`flex-1 min-w-0 overflow-hidden transition-all duration-300 \${sidebarCollapsed ? 'lg:hidden' : ''}\`}>
            <h1 className="text-[15px] font-bold text-white tracking-tight leading-tight">AapkiSociety</h1>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">Smart Management Platform</p>
          </div>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={\`hidden lg:flex items-center justify-center w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-slate-400 hover:text-white transition-all duration-200 shrink-0\`}
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            <ChevronLeft className={\`w-3 h-3 transition-transform duration-300 \${sidebarCollapsed ? 'rotate-180' : ''}\`} />
          </button>
          <button className="lg:hidden text-slate-400 hover:text-white p-1 hover:bg-white/10 rounded-lg transition-colors" onClick={() => setSidebarOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User Card */}
        <Link
          href="/dashboard/profile"
          onClick={() => setSidebarOpen(false)}
          className={\`relative flex items-center gap-3 mx-3 mt-3 mb-1 p-2.5 rounded-xl border border-white/[0.06] hover:border-white/[0.14] transition-all duration-200 group shrink-0 overflow-hidden \${sidebarCollapsed ? 'lg:justify-center lg:p-2 lg:mx-2' : ''}\`}
          style={{ background: 'rgba(255,255,255,0.03)' }}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(139,92,246,0.07) 100%)' }} />
          <div className={\`relative w-9 h-9 bg-gradient-to-br \${currentRoleInfo.gradient} rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-lg\`}>
            {getInitials(user?.first_name || "", user?.last_name || "")}
            <div className="absolute inset-0 rounded-xl ring-2 ring-white/10" />
          </div>
          <div className={\`flex-1 min-w-0 relative z-10 \${sidebarCollapsed ? 'lg:hidden' : ''}\`}>
            <p className="text-[13px] font-semibold text-white/90 truncate leading-tight">{user?.first_name} {user?.last_name}</p>
            <span className={\`inline-flex items-center gap-1 mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full \${currentRoleInfo.bg} \${currentRoleInfo.color}\`}>
              <span className="w-1 h-1 rounded-full bg-current opacity-70" />
              {currentRoleInfo.label}
            </span>
          </div>
          <ChevronRight className={\`w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-all duration-200 relative z-10 group-hover:translate-x-0.5 \${sidebarCollapsed ? 'lg:hidden' : ''}\`} />
        </Link>

        {/* Nav */}
        <nav className={\`flex-1 \${sidebarCollapsed ? 'lg:px-2 px-3' : 'px-3'} py-3 overflow-y-auto overflow-x-hidden custom-scrollbar\`} style={{ scrollbarWidth: sidebarCollapsed ? 'none' : 'thin' }}>
          {Object.entries(groupedNav).map(([section, items]) => {
            const sec = sectionConfig[section];
            return (
              <div key={section} className={\`space-y-0.5 \${section !== "main" ? "mt-5" : ""}\`}>
                {sec?.label && (
                  <div className={\`flex items-center gap-2 px-3 mb-2 \${sidebarCollapsed ? 'lg:hidden' : ''}\`}>
                    <p className={\`text-[9px] font-bold uppercase tracking-[0.2em] \${sec.color} opacity-70\`}>{sec.label}</p>
                    <div className="flex-1 h-px bg-white/[0.05]" />
                  </div>
                )}
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      title={sidebarCollapsed ? item.label : undefined}
                      className={\`relative flex items-center gap-3 rounded-xl text-[13px] font-medium transition-all duration-200 group active:scale-[0.97] overflow-hidden
                        \${sidebarCollapsed ? 'lg:justify-center lg:px-0 lg:py-3 px-3 py-2.5' : 'px-3 py-2.5'}
                        \${active ? 'text-white' : 'text-slate-400 hover:text-white/90'}\`}
                    >
                      {active && <div className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.28) 0%, rgba(139,92,246,0.16) 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 20px rgba(99,102,241,0.15)' }} />}
                      {!active && <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background: 'rgba(255,255,255,0.04)' }} />}
                      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-indigo-400 rounded-r-full" style={{ boxShadow: '0 0 10px rgba(99,102,241,0.9)' }} />}
                      <div className={\`relative flex items-center justify-center w-[30px] h-[30px] rounded-lg shrink-0 transition-all duration-200 \${active ? 'bg-indigo-500/25 shadow-[0_0_12px_rgba(99,102,241,0.25)]' : 'bg-white/[0.04] group-hover:bg-white/[0.08]'}\`}>
                        <Icon className={\`w-[15px] h-[15px] transition-all duration-200 \${active ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300 group-hover:scale-110'}\`} />
                      </div>
                      <span className={\`flex-1 whitespace-nowrap leading-tight relative z-10 \${sidebarCollapsed ? 'lg:hidden' : ''}\`}>{item.label}</span>
                      {active && !sidebarCollapsed && <ChevronRight className="w-3 h-3 text-indigo-400/50 relative z-10 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* AI Badge */}
        {!sidebarCollapsed && (
          <div className="px-3 pb-3 shrink-0">
            <div className="relative overflow-hidden rounded-xl p-3 border border-indigo-500/20" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.08) 100%)' }}>
              <div className="absolute -top-4 -right-4 w-14 h-14 bg-indigo-500/10 rounded-full blur-xl" />
              <div className="flex items-center gap-2.5 relative z-10">
                <div className="w-7 h-7 bg-indigo-500/20 rounded-lg flex items-center justify-center shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-indigo-300 leading-tight">AI Pro Plan</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Smart insights active</p>
                </div>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" style={{ boxShadow: '0 0 6px rgba(52,211,153,0.9)' }} />
              </div>
            </div>
          </div>
        )}

        {/* Sign Out */}
        <div className={\`px-3 pb-4 pt-3 border-t border-white/[0.06] shrink-0 \${sidebarCollapsed ? 'lg:px-2' : ''}\`}>
          <button
            onClick={handleLogout}
            className={\`relative flex items-center gap-3 w-full rounded-xl text-[13px] font-medium text-slate-500 hover:text-red-400 transition-all duration-200 group overflow-hidden
              \${sidebarCollapsed ? 'lg:justify-center lg:px-0 lg:py-3 px-3 py-2.5' : 'px-3 py-2.5'}\`}
            title={sidebarCollapsed ? "Sign Out" : undefined}
          >
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-red-500/[0.08]" />
            <div className="w-[30px] h-[30px] rounded-lg bg-white/[0.04] group-hover:bg-red-500/20 flex items-center justify-center shrink-0 transition-all duration-200">
              <LogOut className="w-[15px] h-[15px] group-hover:translate-x-0.5 transition-transform duration-200" />
            </div>
            <span className={\`relative z-10 \${sidebarCollapsed ? 'lg:hidden' : ''}\`}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 px-5 py-3 border-b border-gray-200/60 transition-all shrink-0" style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(20px)', boxShadow: '0 1px 20px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button className="p-2 hover:bg-indigo-50 active:bg-indigo-100 rounded-xl transition-all duration-200"
                onClick={() => {
                  if (typeof window !== "undefined" && window.innerWidth >= 1024) setSidebarCollapsed(!sidebarCollapsed);
                  else setSidebarOpen(true);
                }}
              >
                <Menu className="w-5 h-5 text-gray-600" />
              </button>
              <div className="hidden sm:flex items-center gap-1.5 text-sm">
                <Link href="/dashboard" className="text-indigo-400 hover:text-indigo-600 transition-colors">
                  <LayoutDashboard className="w-4 h-4" />
                </Link>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                <span className="text-gray-800 font-semibold capitalize tracking-tight">
                  {pathname.split("/").filter(Boolean).slice(-1)[0]?.replace(/-/g, " ") || "Dashboard"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleTheme} className="p-2 hover:bg-gray-100 rounded-xl transition-colors" title={\`Switch to \${theme === 'light' ? 'dark' : 'light'} mode\`}>
                {theme === 'light' ? <Moon className="w-4 h-4 text-gray-500" /> : <Sun className="w-4 h-4 text-gray-400" />}
              </button>
              <button onClick={() => setLocale(locale === "en" ? "hi" : "en")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-gray-200 hover:border-indigo-300 hover:text-indigo-600 text-gray-600 transition-all" title="Switch language">
                {locale === "en" ? "EN" : "HI"}
              </button>
              <button className="relative p-2 hover:bg-indigo-50 rounded-xl transition-colors group">
                <Bell className="w-4 h-4 text-gray-500 group-hover:text-indigo-600 transition-colors" />
                <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full ring-2 ring-white animate-pulse" />
              </button>
              <div className="w-px h-7 bg-gray-200 mx-1" />
              <Link href="/dashboard/profile" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <div className={\`w-8 h-8 bg-gradient-to-br \${currentRoleInfo.gradient} rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-md ring-2 ring-white\`}>
                  {getInitials(user?.first_name || "", user?.last_name || "")}
                </div>
                <div className="hidden md:block leading-tight">
                  <p className="text-[13px] font-semibold text-gray-900">{user?.first_name}</p>
                  <p className={\`text-[10px] font-medium \${currentRoleInfo.color}\`}>{currentRoleInfo.label}</p>
                </div>
              </Link>
            </div>
          </div>
        </header>

        {renewalBanner && userRole === 'ADMIN' && (
          <div className={\`px-5 py-2.5 text-sm font-medium flex items-center justify-between shrink-0 \${renewalBanner.type === 'error' ? 'bg-red-50 text-red-700 border-b border-red-100' : renewalBanner.type === 'warning' ? 'bg-amber-50 text-amber-700 border-b border-amber-100' : 'bg-blue-50 text-blue-700 border-b border-blue-100'}\`}>
            <span>{renewalBanner.title} — {renewalBanner.message}</span>
            {renewalBanner.action && <Link href={renewalBanner.action} className="text-xs underline ml-2 whitespace-nowrap">View</Link>}
          </div>
        )}

        {scrollers.length > 0 && (
          <div className="overflow-hidden border-b border-slate-800 shrink-0" style={{ background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)' }}>
            {(() => {
              const doubled = [...scrollers, ...scrollers];
              const speed = scrollers.some((s: any) => s.scroll_speed === 'FAST') ? 15 : scrollers.some((s: any) => s.scroll_speed === 'SLOW') ? 50 : 30;
              return (
                <div className="flex whitespace-nowrap py-2" style={{ animation: \`marquee \${speed}s linear infinite\` }}>
                  {doubled.map((s: any, i: number) => {
                    const urgencyClass = s.urgency_level === 'URGENT' ? 'bg-red-500/20 text-red-300 border-red-500/30' : s.urgency_level === 'IMPORTANT' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
                    const dot = s.urgency_level === 'URGENT' ? 'bg-red-400' : s.urgency_level === 'IMPORTANT' ? 'bg-amber-400' : 'bg-indigo-400';
                    return (
                      <span key={\`\${s.id}-\${i}\`} className={\`inline-flex items-center gap-2 mx-6 px-3 py-1 rounded-full text-xs font-medium border \${urgencyClass}\`}>
                        <span className={\`w-1.5 h-1.5 rounded-full \${dot} animate-pulse\`} />
                        {s.message}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        <main className="flex-1 p-6 overflow-auto page-enter">
          {children}
        </main>
      </div>
    </div>
  );
}
`;

const targetPath = path.join(
  'C:', 'Users', 'khush', 'OneDrive', 'Desktop', 'aapkisociety',
  'frontend', 'src', 'app', 'dashboard', 'layout.tsx'
);

fs.writeFileSync(targetPath, code, 'utf8');
console.log('layout.tsx written successfully, lines:', code.split('\\n').length);
