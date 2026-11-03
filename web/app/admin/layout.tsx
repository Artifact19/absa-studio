import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Console | ABSA Studio",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#edf1f7] text-slate-900">
      {children}
    </div>
  );
}
