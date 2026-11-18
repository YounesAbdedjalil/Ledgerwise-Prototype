"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const icons: Record<string, React.ReactNode> = {
  building: <><path d="M3.5 20.5h17M5.5 20.5V6.8L12 3.5l6.5 3.3v13.7M8.5 9h1m5 0h1m-7 4h1m5 0h1m-5 7.5v-4h3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
  messages: <><path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20.5 11.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 10h8M8 13.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17M8 13h2m4 0h2m-8 4h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>,
  users: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.5a4 4 0 0 1 0 7.7m2 3.3a4 4 0 0 1 3 3.9V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
  settings: <><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></>,
};

export default function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition md:w-full md:flex-col md:gap-1.5 md:px-1 md:py-3 md:text-center ${
        active
          ? "bg-cyan-300/10 text-cyan-100 shadow-[inset_3px_0_0_#65e1ff] md:shadow-[inset_0_0_0_1px_rgba(101,225,255,.18)]"
          : "text-slate-400 hover:bg-white/[.06] hover:text-white"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" className={`h-[19px] w-[19px] shrink-0 transition-colors md:h-[21px] md:w-[21px] ${active ? "text-cyan-200" : "text-slate-500 group-hover:text-cyan-100"}`} aria-hidden="true">
        {icons[icon]}
      </svg>
      <span className="whitespace-nowrap md:text-[9px] md:font-semibold md:tracking-wide">{label}</span>
    </Link>
  );
}
