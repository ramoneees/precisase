-- CreateTable
CREATE TABLE "site_configs" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "site_configs_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "site_configs" ADD CONSTRAINT "site_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
