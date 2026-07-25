import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;

  if (!session?.user) {
    redirect({ href: "/signin", locale: locale as AppLocale });
  }

  if (role !== "admin" && role !== "moderator") {
    redirect({ href: "/", locale: locale as AppLocale });
  }

  return <>{children}</>;
}
