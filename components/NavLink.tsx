"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const icons: Record<string, React.ReactNode> = {
  building: <><path d="M3.5 20.5h17M5.5 20.5V6.8L12 3.5l6.5 3.3v13.7M8.5 9h1m5 0h1m-7 4h1m5 0h1m-5 7.5v-4h3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
  messages: <><path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20.5 11.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 10h8M8 13.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17M8 13h2m4 0h2m-8 4h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>,
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
      className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition md:w-full ${
        active
          ? "bg-[#eaf3fc] text-[#1c568d] shadow-[inset_3px_0_0_#2878c7]"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[#2878c7]" : "text-slate-400 group-hover:text-slate-600"}`} aria-hidden="true">
        {icons[icon]}
      </svg>
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}
