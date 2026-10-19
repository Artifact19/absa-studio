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
    <div className="min-h-screen bg-neutral-900 text-neutral-100 dark:bg-black">
      {children}
    </div>
  );
}
