import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { listCategories } from "@/server/categories";
import { CreatePostForm } from "./create-post-form";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "post.createForm" });
  return { title: t("heading") };
}

export default async function NewPostPage() {
  const locale = await getLocale();
  const session = await auth();
  if (!session?.user) {
    redirect({ href: "/signin", locale });
  }

  const categories = await listCategories();
  const t = await getTranslations({ locale, namespace: "post.createForm" });

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("heading")}
        </h1>
        <p className="text-sm text-[#6B7268]">{t("subtitle")}</p>
      </div>

      <CreatePostForm categories={categories} />
    </main>
  );
}
