"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateBrandingAction } from "./branding-actions";
import type { SiteConfig } from "@/server/services/branding-service";

interface BrandingFormProps {
  initial: SiteConfig;
}

export function BrandingForm({ initial }: BrandingFormProps) {
  const t = useTranslations("admin.settings");
  const [siteName, setSiteName] = useState(initial.siteName);
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor);
  const [accentColor, setAccentColor] = useState(initial.accentColor);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function handleFileUpload(field: "logo" | "favicon", file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("field", field);

    const res = await fetch("/api/uploads/branding", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");
    const { url } = await res.json();

    if (field === "logo") setLogoUrl(url);
    else setFaviconUrl(url);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateBrandingAction({
        siteName,
        primaryColor,
        accentColor,
        logoUrl,
        faviconUrl,
      });
      setResult(res);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Site name */}
      <div>
        <label htmlFor="site-name" className="block text-sm font-medium mb-1">
          {t("siteName")}
        </label>
        <input
          id="site-name"
          type="text"
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
          placeholder={t("siteNamePlaceholder")}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </div>

      {/* Primary color */}
      <div>
        <label htmlFor="primary-color" className="block text-sm font-medium mb-1">
          {t("primaryColor")}
        </label>
        <div className="flex gap-2">
          <input
            id="primary-color"
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="h-10 w-20 rounded border border-gray-300"
          />
          <input
            type="text"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#2F6B4F"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
          />
        </div>
      </div>

      {/* Accent color */}
      <div>
        <label htmlFor="accent-color" className="block text-sm font-medium mb-1">
          {t("accentColor")}
        </label>
        <div className="flex gap-2">
          <input
            id="accent-color"
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="h-10 w-20 rounded border border-gray-300"
          />
          <input
            type="text"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            placeholder="#C4622D"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
          />
        </div>
      </div>

      {/* Logo upload */}
      <div>
        <label className="block text-sm font-medium mb-1">{t("logo")}</label>
        {logoUrl && (
          <div className="mb-2">
            <img src={logoUrl} alt="Logo preview" className="h-16 w-auto rounded" />
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload("logo", file);
          }}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {/* Favicon upload */}
      <div>
        <label className="block text-sm font-medium mb-1">{t("favicon")}</label>
        {faviconUrl && (
          <div className="mb-2">
            <img src={faviconUrl} alt="Favicon preview" className="h-8 w-8 rounded" />
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload("favicon", file);
          }}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save"}
      </button>

      {/* Result message */}
      {result && (
        <div className={`rounded-md p-3 text-sm ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {result.ok ? t("brandingSaved") : result.error}
        </div>
      )}
    </form>
  );
}
